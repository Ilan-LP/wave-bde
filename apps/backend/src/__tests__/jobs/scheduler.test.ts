import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAuditLogExport } from "../../jobs/auditLogExport.js";
import { msUntilNextRun, scheduleDailyAuditExport } from "../../jobs/scheduler.js";

vi.mock("../../jobs/auditLogExport.js", () => ({
  runAuditLogExport: vi.fn(),
}));

const runExport = vi.mocked(runAuditLogExport);

describe("msUntilNextRun", () => {
  it("returns the ms until 03:00 UTC later the same day when called before that time", () => {
    const now = new Date("2026-09-07T01:00:00.000Z");
    expect(msUntilNextRun(now)).toBe(2 * 60 * 60 * 1000);
  });

  it("rolls over to 03:00 UTC the next day when called after that time", () => {
    const now = new Date("2026-09-07T10:00:00.000Z");
    expect(msUntilNextRun(now)).toBe(17 * 60 * 60 * 1000);
  });

  it("rolls over to the next day when called exactly at 03:00 UTC", () => {
    const now = new Date("2026-09-07T03:00:00.000Z");
    expect(msUntilNextRun(now)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("scheduleDailyAuditExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T01:00:00.000Z"));
    runExport.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the export at the next scheduled time and reschedules for the following day", async () => {
    scheduleDailyAuditExport();

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(runExport).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(runExport).toHaveBeenCalledTimes(2);
  });

  it("logs and reschedules instead of throwing when a run fails", async () => {
    runExport.mockRejectedValueOnce(new Error("export failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    scheduleDailyAuditExport();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    expect(consoleError).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(runExport).toHaveBeenCalledTimes(2);

    consoleError.mockRestore();
  });
});
