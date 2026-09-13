import { runAuditLogExport } from "./auditLogExport.js";
import { runRechargeReconciliation } from "./rechargeReconciliation.js";
import { runBuvetteCardReconciliation } from "./buvetteCardReconciliation.js";

const EXPORT_HOUR_UTC = 3;

// A separate, much tighter cadence than the daily export above: the export
// is a passive backup with no urgency, but a RechargeCheckout stuck PENDING
// blocks a real member's spendable balance and risks a confusing
// double-payment (see CLAUDE.md bug-audit B3), so it's checked every 15
// minutes rather than once a day.
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;

export function msUntilNextRun(now: Date): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), EXPORT_HOUR_UTC, 0, 0, 0),
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function scheduleNextRun(): void {
  setTimeout(() => {
    void runAndReschedule();
  }, msUntilNextRun(new Date()));
}

async function runAndReschedule(): Promise<void> {
  try {
    await runAuditLogExport();
  } catch (err) {
    console.error("[audit-export] scheduled run failed", err);
  } finally {
    scheduleNextRun();
  }
}

/**
 * Starts the daily audit log export job, firing at 03:00 UTC every day.
 * Recursive setTimeout (not setInterval) so a slow/failed run can't overlap
 * the next one — the reschedule happens in a finally, so one bad night
 * doesn't stop future runs. Call once from src/index.ts, never from
 * src/app.ts/createApp(), so no background timer is ever spun up by
 * createApp()-based tests.
 */
export function scheduleDailyAuditExport(): void {
  scheduleNextRun();
}

function scheduleNextReconciliation(): void {
  setTimeout(() => {
    void runReconciliationAndReschedule();
  }, RECONCILIATION_INTERVAL_MS);
}

async function runReconciliationAndReschedule(): Promise<void> {
  try {
    await runRechargeReconciliation();
  } catch (err) {
    console.error("[recharge-reconciliation] scheduled run failed", err);
  } finally {
    scheduleNextReconciliation();
  }
}

/**
 * Starts the recharge reconciliation job, firing every
 * RECONCILIATION_INTERVAL_MS (15 minutes). Same recursive-setTimeout shape
 * as scheduleDailyAuditExport above, for the same reason: a slow/failed run
 * can't overlap the next one, and one failed run doesn't stop future ones.
 * Call once from src/index.ts, never from src/app.ts/createApp().
 */
export function scheduleRechargeReconciliation(): void {
  scheduleNextReconciliation();
}

// Tighter than the recharge job's 15 minutes: a card checkout's SumUp-side
// window is already only 60 seconds (see CARD_CHECKOUT_STALE_MS in
// src/lib/buvetteCard.ts), so a stuck row is worth checking on sooner — the
// common case (a poll from a still-open till tab) already resolves most
// checkouts long before this job would ever see them; this is purely the
// crashed-tab backstop.
const BUVETTE_CARD_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;

function scheduleNextBuvetteCardReconciliation(): void {
  setTimeout(() => {
    void runBuvetteCardReconciliationAndReschedule();
  }, BUVETTE_CARD_RECONCILIATION_INTERVAL_MS);
}

async function runBuvetteCardReconciliationAndReschedule(): Promise<void> {
  try {
    await runBuvetteCardReconciliation();
  } catch (err) {
    console.error("[buvette-card-reconciliation] scheduled run failed", err);
  } finally {
    scheduleNextBuvetteCardReconciliation();
  }
}

/**
 * Starts the buvette card-checkout reconciliation job, firing every
 * BUVETTE_CARD_RECONCILIATION_INTERVAL_MS (5 minutes). Same
 * recursive-setTimeout shape as the other two jobs above. Call once from
 * src/index.ts, never from src/app.ts/createApp().
 */
export function scheduleBuvetteCardReconciliation(): void {
  scheduleNextBuvetteCardReconciliation();
}
