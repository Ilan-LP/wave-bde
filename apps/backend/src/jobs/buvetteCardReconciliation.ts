import { prisma } from "../lib/prisma.js";
import { getTransactionByClientId } from "../lib/sumup.js";
import { applyCardCheckoutStatus, CARD_CHECKOUT_STALE_MS } from "../lib/buvetteCard.js";

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
 * Reuses applyCardCheckoutStatus (src/lib/buvetteCard.ts) — the exact same
 * state-transition logic the confirm endpoint uses, including its race-safe
 * conditional updateMany, so a checkout resolved by a poll at the same
 * moment this job reaches it can never be double-processed.
 *
 * One bad row (a network blip talking to SumUp, or any other per-row
 * failure) is logged and skipped — it must never stop the rest of the batch
 * from being reconciled.
 */
export async function runBuvetteCardReconciliation(): Promise<void> {
  const staleBefore = new Date(Date.now() - CARD_CHECKOUT_STALE_MS);
  const staleCheckouts = await prisma.buvetteCardCheckout.findMany({
    where: { status: "PENDING", createdAt: { lt: staleBefore } },
  });

  if (staleCheckouts.length === 0) {
    console.log("[buvette-card-reconciliation] no stale PENDING card checkouts found");
    return;
  }

  console.log(`[buvette-card-reconciliation] found ${staleCheckouts.length} stale PENDING card checkout(s)`);

  for (const cardCheckout of staleCheckouts) {
    try {
      const sumupStatus = await getTransactionByClientId(cardCheckout.clientTransactionId);
      const resolution = await applyCardCheckoutStatus({
        cardCheckout,
        sumupStatus,
        actorId: null,
        ipAddress: null,
        source: "reconciliation-job",
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
}
