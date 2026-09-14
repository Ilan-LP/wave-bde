import { prisma } from "../lib/prisma.js";
import { getTransactionByClientId } from "../lib/sumup.js";
import {
  applyCardCheckoutStatus,
  recheckForcedCancellation,
  CARD_CHECKOUT_STALE_MS,
  FORCED_CANCEL_RECHECK_DELAY_MS,
} from "../lib/buvetteCard.js";

// Mirrors buvette.ts's own CANCEL_GRACE_MS (POST
// /buvette/card/checkout/:id/confirm), which is a local, unexported const
// there. Kept as a separate literal rather than importing it, same "mirrored
// constant, not a second guessed rule" convention CLAUDE.md documents for
// e.g. the buvette frontend's MAX_QUANTITY / RegisterScreen's
// MIN_PASSWORD_LENGTH — if buvette.ts's CANCEL_GRACE_MS ever changes, update
// this value too.
const CANCEL_GRACE_MS = 8 * 1000;

/**
 * Reconciles BuvetteCardCheckout rows stuck PENDING past
 * CARD_CHECKOUT_STALE_MS — i.e. the till's browser tab crashed, lost
 * network, or the cashier navigated away mid-payment before a poll ever saw
 * a terminal SumUp status. Without this job those rows sit PENDING forever
 * even though SumUp may have already charged (or definitively failed) the
 * card, leaving the sale in the exact "ambiguous state" this feature must
 * avoid. Same class of bug as RechargeCheckout's B3, fixed by
 * runRechargeReconciliation (see CLAUDE.md "Recharge Reconciliation Job").
 *
 * Also applies the same cancel-grace-period fallback POST
 * /buvette/card/checkout/:id/confirm uses (buvette.ts, ~line 632): if a
 * stale-PENDING row's cancelRequestedAt is set and older than
 * CANCEL_GRACE_MS, and SumUp still shows no transaction, it's forced to
 * CANCELLED (via applyCardCheckoutStatus's forcedCancel flag) instead of
 * looping as still-pending forever. This closes the gap where a cashier
 * cancels and the tab crashes/loses network before another poll ever
 * observes the forced cancellation itself — without this, such a row would
 * never reach CANCELLED at all, and so would never become eligible for the
 * forced-cancel-recheck pass below either.
 *
 * Also re-checks BuvetteCardCheckout rows that were forced to CANCELLED by
 * the confirm endpoint's grace-period fallback (forcedCancelAt set, see
 * POST /buvette/card/checkout/:id/confirm) rather than an actual observed
 * SumUp status — exactly one follow-up check each, FORCED_CANCEL_RECHECK_DELAY_MS
 * after the forced cancellation, via recheckForcedCancellation. Without this,
 * a checkout the till gave up waiting on has no path left to notice SumUp
 * later actually recording the charge, leaving a paid customer silently
 * marked "cancelled, no charge" forever. Bounded to one check per row via
 * forcedCancelRecheckedAt — this query only ever matches a row once.
 *
 * Reuses applyCardCheckoutStatus / recheckForcedCancellation
 * (src/lib/buvetteCard.ts) — the exact same state-transition logic the
 * confirm endpoint uses, including their race-safe conditional updateMany
 * calls, so a checkout resolved by a poll at the same moment this job
 * reaches it can never be double-processed.
 *
 * One bad row (a network blip talking to SumUp, or any other per-row
 * failure) is logged and skipped — it must never stop the rest of the batch
 * from being reconciled.
 */
export async function runBuvetteCardReconciliation(): Promise<void> {
  const staleBefore = new Date(Date.now() - CARD_CHECKOUT_STALE_MS);
  const forcedCancelRecheckBefore = new Date(Date.now() - FORCED_CANCEL_RECHECK_DELAY_MS);

  const [staleCheckouts, forcedCancelCheckouts] = await Promise.all([
    prisma.buvetteCardCheckout.findMany({
      where: { status: "PENDING", createdAt: { lt: staleBefore } },
    }),
    prisma.buvetteCardCheckout.findMany({
      where: {
        status: "CANCELLED",
        forcedCancelAt: { not: null, lt: forcedCancelRecheckBefore },
        forcedCancelRecheckedAt: null,
      },
    }),
  ]);

  if (staleCheckouts.length === 0 && forcedCancelCheckouts.length === 0) {
    console.log("[buvette-card-reconciliation] no stale PENDING or forced-cancel-recheck card checkouts found");
    return;
  }

  console.log(
    `[buvette-card-reconciliation] found ${staleCheckouts.length} stale PENDING and ` +
      `${forcedCancelCheckouts.length} forced-cancel-recheck card checkout(s)`,
  );

  for (const cardCheckout of staleCheckouts) {
    try {
      let sumupStatus = await getTransactionByClientId(cardCheckout.clientTransactionId);

      let forcedCancel = false;
      if (
        sumupStatus === "PENDING" &&
        cardCheckout.cancelRequestedAt &&
        Date.now() - cardCheckout.cancelRequestedAt.getTime() > CANCEL_GRACE_MS
      ) {
        // Same fallback as the confirm endpoint's grace-period logic: trust
        // the termination worked rather than leaving this checkout PENDING
        // forever with no poll left to resolve it.
        sumupStatus = "CANCELLED";
        forcedCancel = true;
      }

      const resolution = await applyCardCheckoutStatus({
        cardCheckout,
        sumupStatus,
        actorId: null,
        ipAddress: null,
        source: "reconciliation-job",
        forcedCancel,
      });

      if (resolution.outcome === "resolved") {
        console.log(
          `[buvette-card-reconciliation] resolved checkout ${cardCheckout.id} as ${resolution.status}`,
        );
      }
      // "still-pending" / "already-resolved": nothing to do — either SumUp
      // itself hasn't resolved it yet, or a concurrent poll already did.
    } catch (err) {
      console.error(`[buvette-card-reconciliation] failed to reconcile checkout ${cardCheckout.id}`, err);
    }
  }

  for (const cardCheckout of forcedCancelCheckouts) {
    try {
      const sumupStatus = await getTransactionByClientId(cardCheckout.clientTransactionId);
      const resolution = await recheckForcedCancellation({ cardCheckout, sumupStatus });

      if (resolution.outcome === "corrected-to-successful") {
        console.error(
          `[buvette-card-reconciliation] corrected forced-cancel checkout ${cardCheckout.id} to SUCCESSFUL ` +
            "— needs manual review",
        );
      }
      // "confirmed-cancelled" / "already-rechecked": nothing to do — SumUp
      // confirms no charge went through, or a concurrent run already
      // resolved this recheck.
    } catch (err) {
      console.error(
        `[buvette-card-reconciliation] failed to recheck forced-cancel checkout ${cardCheckout.id}`,
        err,
      );
    }
  }
}
