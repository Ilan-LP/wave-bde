import { runAuditLogExport } from "./auditLogExport.js";

const EXPORT_HOUR_UTC = 3;

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
