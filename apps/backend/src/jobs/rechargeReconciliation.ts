import { prisma } from "../lib/prisma.js";
import { getCheckoutStatus } from "../lib/sumup.js";
import { applySumUpCheckoutStatus, CHECKOUT_VALID_MS } from "../lib/recharge.js";

/**
 * Reconciles RechargeCheckout rows stuck PENDING past CHECKOUT_VALID_MS —
 * i.e. a member paid via SumUp's hosted checkout but never returned to the
 * app to trigger POST /me/recharge/:id/confirm (closed tab, lost network,
 * backgrounded mobile browser). Without this job those rows sit PENDING
 * forever and the member's points never land, even though SumUp has the
 * money (see CLAUDE.md's bug-audit finding B3).
 *
 * Reuses applySumUpCheckoutStatus (src/lib/recharge.ts) — the exact same
 * state-transition logic the manual confirm endpoint uses, including its
 * race-safe conditional updateMany, so a checkout confirmed manually at the
 * same moment this job reaches it can never be double-credited.
 *
 * One bad row (a network blip talking to SumUp, or any other per-row
 * failure) is logged and skipped — it must never stop the rest of the
 * batch from being reconciled.
 */
export async function runRechargeReconciliation(): Promise<void> {
  const staleBefore = new Date(Date.now() - CHECKOUT_VALID_MS);
  const staleCheckouts = await prisma.rechargeCheckout.findMany({
    where: { status: "PENDING", createdAt: { lt: staleBefore } },
  });

  if (staleCheckouts.length === 0) {
    console.log("[recharge-reconciliation] no stale PENDING recharge checkouts found");
    return;
  }

  console.log(`[recharge-reconciliation] found ${staleCheckouts.length} stale PENDING recharge checkout(s)`);

  for (const rechargeCheckout of staleCheckouts) {
    try {
      const sumupStatus = await getCheckoutStatus(rechargeCheckout.sumupCheckoutId);
      const resolution = await applySumUpCheckoutStatus({
        rechargeCheckout,
        sumupStatus,
        actorId: null,
        ipAddress: null,
        source: "reconciliation-job",
      });

      if (resolution.outcome === "credited") {
        console.log(
          `[recharge-reconciliation] credited ${rechargeCheckout.points} points for checkout ${rechargeCheckout.id}`,
        );
      } else if (resolution.outcome === "failed-or-expired") {
        console.log(
          `[recharge-reconciliation] marked checkout ${rechargeCheckout.id} as ${resolution.status}`,
        );
      }
      // "still-pending" / "already-confirmed": nothing to do — either SumUp
      // itself hasn't resolved it yet, or a concurrent confirm/reconcile
      // call already did.
    } catch (err) {
      console.error(`[recharge-reconciliation] failed to reconcile checkout ${rechargeCheckout.id}`, err);
    }
  }
}
