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

export type CardCheckoutTerminalStatus = "SUCCESSFUL" | "FAILED" | "CANCELLED";

export type CardCheckoutResolution =
  | { outcome: "still-pending" }
  | { outcome: "resolved"; status: CardCheckoutTerminalStatus }
  | { outcome: "already-resolved"; status: CardCheckoutTerminalStatus };

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
}): Promise<CardCheckoutResolution> {
  const { cardCheckout, sumupStatus, actorId, ipAddress, source } = params;

  if (sumupStatus === "PENDING") {
    return { outcome: "still-pending" };
  }

  const newStatus = toTerminalStatus(sumupStatus);

  const flipped = await prisma.buvetteCardCheckout.updateMany({
    where: { id: cardCheckout.id, status: "PENDING" },
    data: { status: newStatus, resolvedAt: new Date() },
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
    metadata: { source, sumupStatus, previousStatus: "PENDING", newStatus },
  });

  return { outcome: "resolved", status: newStatus };
}
