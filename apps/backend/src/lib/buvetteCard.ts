import type { BuvetteCardCheckout } from "@prisma/client";
import { prisma } from "./prisma.js";
import { writeAuditLog } from "../middleware/audit.js";
import type { SumUpTransactionStatus } from "./sumup.js";

// SumUp gives a reader checkout a 60-second window to start on the device.
// Also doubles as the staleness threshold the buvette card reconciliation
// job uses to decide a PENDING BuvetteCardCheckout is worth re-checking
// against SumUp (see src/jobs/buvetteCardReconciliation.ts) — by then SumUp
// will have resolved it one way or another, same reasoning as
// recharge.ts's CHECKOUT_VALID_MS.
export const CARD_CHECKOUT_STALE_MS = 2 * 60 * 1000;

// A CANCELLED row that was forced (see applyCardCheckoutStatus's
// forcedCancel param and POST /buvette/card/checkout/:id/confirm's grace
// period) gets exactly one follow-up check against SumUp's real transaction
// status, this long after the forced cancellation. Long enough that SumUp
// would have recorded any charge that started right at the grace-period
// boundary; short enough that a genuine discrepancy doesn't sit unnoticed.
// Bounded to one check via forcedCancelRecheckedAt — this is not a retry
// loop, see recheckForcedCancellation.
export const FORCED_CANCEL_RECHECK_DELAY_MS = 5 * 60 * 1000;

export type CardCheckoutTerminalStatus = "SUCCESSFUL" | "FAILED" | "CANCELLED";

export type CardCheckoutResolution =
  | { outcome: "still-pending" }
  | { outcome: "resolved"; status: CardCheckoutTerminalStatus }
  | { outcome: "already-resolved"; status: CardCheckoutTerminalStatus };

export type ForcedCancelRecheckResolution =
  | { outcome: "corrected-to-successful" }
  | { outcome: "confirmed-cancelled" }
  | { outcome: "already-rechecked" };

function toTerminalStatus(sumupStatus: SumUpTransactionStatus): CardCheckoutTerminalStatus {
  if (sumupStatus === "SUCCESSFUL") {
    return "SUCCESSFUL";
  }
  if (sumupStatus === "CANCELLED") {
    return "CANCELLED";
  }
  // FAILED / REFUNDED / CHARGE_BACK all mean the sale did not go through as
  // a normal successful card-present payment for this till session.
  return "FAILED";
}

/**
 * Applies a resolved SumUp transaction status to a PENDING
 * BuvetteCardCheckout, shared by GET /buvette/card/checkout/:id
 * (src/routes/buvette.ts) and the buvette card reconciliation job
 * (src/jobs/buvetteCardReconciliation.ts) so there is one implementation of
 * this state-transition logic, not two — same shape as
 * applySumUpCheckoutStatus in src/lib/recharge.ts.
 *
 * The caller is responsible for its own getTransactionByClientId call/error
 * handling first, including the cancel-grace-period policy for a checkout
 * whose cancelRequestedAt is set (see POST /buvette/card/checkout/:id/cancel
 * and CLAUDE.md's "Buvette Card Payment" section) — this function only
 * reacts to an already-known status, exactly like applySumUpCheckoutStatus.
 *
 * Race-safe: the transition is gated by a conditional updateMany checked for
 * status still being PENDING, so this can never resolve the same checkout
 * twice even if a poll and the reconciliation job reach it concurrently.
 *
 * No PointsAccount/Transaction write here — a card-present sale never
 * identifies a customer, so there is nothing to credit or debit (see
 * CLAUDE.md's "Buvette Card Payment" section for why this is deliberate,
 * not an oversight).
 */
export async function applyCardCheckoutStatus(params: {
  cardCheckout: BuvetteCardCheckout;
  sumupStatus: SumUpTransactionStatus;
  actorId: string | null;
  ipAddress?: string | null;
  source: "poll-endpoint" | "reconciliation-job";
  // True when the caller already overrode sumupStatus to "CANCELLED" via the
  // confirm endpoint's grace-period fallback (POST
  // /buvette/card/checkout/:id/confirm) rather than a real SumUp status —
  // stamps forcedCancelAt so the row is both distinguishable from a genuine
  // SumUp cancellation and findable by the reconciliation job's follow-up
  // check (see recheckForcedCancellation below).
  forcedCancel?: boolean;
}): Promise<CardCheckoutResolution> {
  const { cardCheckout, sumupStatus, actorId, ipAddress, source, forcedCancel = false } = params;

  if (sumupStatus === "PENDING") {
    return { outcome: "still-pending" };
  }

  const newStatus = toTerminalStatus(sumupStatus);

  const flipped = await prisma.buvetteCardCheckout.updateMany({
    where: { id: cardCheckout.id, status: "PENDING" },
    data: {
      status: newStatus,
      resolvedAt: new Date(),
      ...(forcedCancel && newStatus === "CANCELLED" ? { forcedCancelAt: new Date() } : {}),
    },
  });

  if (flipped.count === 0) {
    // Lost the race to a concurrent poll/reconciliation call — don't log or
    // resolve twice. Re-read to report whatever the winner actually landed.
    const current = await prisma.buvetteCardCheckout.findUnique({ where: { id: cardCheckout.id } });
    return { outcome: "already-resolved", status: (current?.status as CardCheckoutTerminalStatus) ?? newStatus };
  }

  writeAuditLog({
    actorId,
    action: "UPDATE",
    entityType: "BuvetteCardCheckout",
    entityId: cardCheckout.id,
    ipAddress,
    metadata: {
      source,
      sumupStatus,
      previousStatus: "PENDING",
      newStatus,
      ...(forcedCancel && newStatus === "CANCELLED" ? { forcedCancel: true } : {}),
    },
  });

  return { outcome: "resolved", status: newStatus };
}

/**
 * One-time follow-up check for a BuvetteCardCheckout that was previously
 * flipped to CANCELLED via the confirm endpoint's grace-period fallback
 * (forcedCancelAt is set) rather than an actual observed SumUp status. Only
 * ever called by the reconciliation job (src/jobs/buvetteCardReconciliation.ts),
 * FORCED_CANCEL_RECHECK_DELAY_MS after the forced cancellation.
 *
 * Without this, a checkout forced to CANCELLED because SumUp hadn't recorded
 * a transaction yet has no code path left to notice if SumUp later did
 * record one — a paid customer would be silently left marked
 * "cancelled, no charge" forever (see CLAUDE.md's "Buvette Card Payment"
 * section).
 *
 * Race-safe and bounded to a single check: the update is gated on
 * `status: "CANCELLED", forcedCancelRecheckedAt: null`, and always stamps
 * forcedCancelRecheckedAt regardless of outcome, so this row is never
 * selected by the job's query again after this call.
 *
 * If SumUp shows the charge actually completed, the checkout is corrected to
 * SUCCESSFUL (the ledger should reflect that the customer really was
 * charged) and a distinctly-tagged, flagged-for-manual-review audit log
 * entry is written — the cashier may already have told the customer the
 * sale was cancelled and not handed over product/receipt, which is a
 * fulfillment problem a human needs to resolve, not something this function
 * can fix on its own.
 */
export async function recheckForcedCancellation(params: {
  cardCheckout: BuvetteCardCheckout;
  sumupStatus: SumUpTransactionStatus;
}): Promise<ForcedCancelRecheckResolution> {
  const { cardCheckout, sumupStatus } = params;
  const now = new Date();
  const correctedToSuccessful = sumupStatus === "SUCCESSFUL";

  const flipped = await prisma.buvetteCardCheckout.updateMany({
    where: { id: cardCheckout.id, status: "CANCELLED", forcedCancelRecheckedAt: null },
    data: {
      forcedCancelRecheckedAt: now,
      ...(correctedToSuccessful ? { status: "SUCCESSFUL", resolvedAt: now } : {}),
    },
  });

  if (flipped.count === 0) {
    // Already rechecked (or resolved some other way) by a concurrent run —
    // don't log or correct twice.
    return { outcome: "already-rechecked" };
  }

  if (correctedToSuccessful) {
    console.error(
      `[buvette-card-reconciliation] FORCED-CANCEL CORRECTION: checkout ${cardCheckout.id} was marked ` +
        "CANCELLED via the grace-period fallback, but SumUp shows the charge actually completed — corrected " +
        "to SUCCESSFUL. Needs manual review: the till likely already told the cashier it was cancelled.",
    );
  }

  writeAuditLog({
    actorId: null,
    action: "UPDATE",
    entityType: "BuvetteCardCheckout",
    entityId: cardCheckout.id,
    ipAddress: null,
    metadata: {
      source: "reconciliation-job-forced-cancel-recheck",
      sumupStatus,
      previousStatus: "CANCELLED",
      forcedCancel: true,
      newStatus: correctedToSuccessful ? "SUCCESSFUL" : "CANCELLED",
      needsManualReview: correctedToSuccessful,
    },
  });

  return { outcome: correctedToSuccessful ? "corrected-to-successful" : "confirmed-cancelled" };
}
