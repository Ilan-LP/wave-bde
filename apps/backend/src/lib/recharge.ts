import type { RechargeCheckout } from "@prisma/client";
import { prisma } from "./prisma.js";
import { writeAuditLog } from "../middleware/audit.js";
import type { SumUpCheckoutStatus } from "./sumup.js";

// How long an unpaid hosted checkout stays payable — mirrors the TTL
// discipline already used for the buvette QR token (see qrToken.ts). Also
// doubles as the staleness threshold the recharge reconciliation job uses
// to decide a PENDING RechargeCheckout is worth re-checking against SumUp
// (see src/jobs/rechargeReconciliation.ts): by the time this much time has
// passed, SumUp will have resolved the checkout one way or another.
export const CHECKOUT_VALID_MS = 30 * 60 * 1000;

export type RechargeResolution =
  | { outcome: "still-pending" }
  | { outcome: "failed-or-expired"; status: "FAILED" | "EXPIRED" }
  | { outcome: "already-confirmed"; newBalance: number }
  | { outcome: "credited"; transactionId: string; newBalance: number };

/**
 * Applies a SumUp checkout status to a PENDING RechargeCheckout, shared by
 * POST /me/recharge/:id/confirm (src/routes/me.ts) and the recharge
 * reconciliation job (src/jobs/rechargeReconciliation.ts) so there is one
 * implementation of this state-transition logic, not two. The caller is
 * responsible for its own getCheckoutStatus call/error handling first —
 * this function only reacts to an already-known status.
 *
 * Race-safe: both the FAILED/EXPIRED flip and the PAID credit go through a
 * conditional updateMany gated on status still being PENDING, so this can
 * never double-credit even if it runs concurrently with another call for
 * the same checkout (e.g. a manual confirm and this job overlapping).
 *
 * Audits FAILED/EXPIRED and credited outcomes directly via writeAuditLog
 * (fixes AUDIT-security.md's M2 — those transitions previously never
 * reached the audit log, since the manual endpoint's FAILED/EXPIRED
 * response is a 402 and the generic auditLog middleware only logs
 * statusCode < 400; and since this job runs outside any request/response
 * cycle, it can't rely on that middleware at all).
 */
export async function applySumUpCheckoutStatus(params: {
  rechargeCheckout: RechargeCheckout;
  sumupStatus: SumUpCheckoutStatus;
  actorId: string | null;
  ipAddress?: string | null;
  source: "confirm-endpoint" | "reconciliation-job";
}): Promise<RechargeResolution> {
  const { rechargeCheckout, sumupStatus, actorId, ipAddress, source } = params;

  if (sumupStatus === "PENDING") {
    return { outcome: "still-pending" };
  }

  if (sumupStatus !== "PAID") {
    const newStatus: "FAILED" | "EXPIRED" = sumupStatus === "EXPIRED" ? "EXPIRED" : "FAILED";
    const flipped = await prisma.rechargeCheckout.updateMany({
      where: { id: rechargeCheckout.id, status: "PENDING" },
      data: { status: newStatus },
    });
    if (flipped.count > 0) {
      writeAuditLog({
        actorId,
        action: "UPDATE",
        entityType: "RechargeCheckout",
        entityId: rechargeCheckout.id,
        ipAddress,
        metadata: { source, sumupStatus, previousStatus: "PENDING", newStatus },
      });
    }
    return { outcome: "failed-or-expired", status: newStatus };
  }

  let transactionId: string | undefined;
  let newBalance: number | undefined;
  let credited = false;

  await prisma.$transaction(async (tx) => {
    const flipped = await tx.rechargeCheckout.updateMany({
      where: { id: rechargeCheckout.id, status: "PENDING" },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    if (flipped.count === 0) {
      // Lost the race to a concurrent confirm/reconciliation call — don't credit twice.
      return;
    }
    credited = true;

    await tx.pointsAccount.update({
      where: { id: rechargeCheckout.pointsAccountId },
      data: { balance: { increment: rechargeCheckout.points } },
    });

    const created = await tx.transaction.create({
      data: {
        pointsAccountId: rechargeCheckout.pointsAccountId,
        type: "TOPUP",
        amount: rechargeCheckout.points,
        description: "SumUp card recharge",
        metadata: {
          sumupCheckoutId: rechargeCheckout.sumupCheckoutId,
          amountMinorUnit: rechargeCheckout.amountMinorUnit,
          currency: rechargeCheckout.currency,
        },
      },
    });
    transactionId = created.id;

    const account = await tx.pointsAccount.findUnique({ where: { id: rechargeCheckout.pointsAccountId } });
    newBalance = account?.balance;
  });

  if (!credited) {
    const account = await prisma.pointsAccount.findUnique({ where: { id: rechargeCheckout.pointsAccountId } });
    return { outcome: "already-confirmed", newBalance: account?.balance ?? 0 };
  }

  writeAuditLog({
    actorId,
    action: "UPDATE",
    entityType: "Transaction",
    entityId: transactionId!,
    ipAddress,
    metadata: {
      source,
      sumupStatus,
      rechargeCheckoutId: rechargeCheckout.id,
      pointsCredited: rechargeCheckout.points,
    },
  });

  return { outcome: "credited", transactionId: transactionId!, newBalance: newBalance! };
}
