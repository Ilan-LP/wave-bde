import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { uploadJsonExport } from "../../jobs/googleDrive.js";
import { runAuditLogExport } from "../../jobs/auditLogExport.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    auditExportCursor: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../jobs/googleDrive.js", () => ({
  uploadJsonExport: vi.fn(),
}));

const findCursor = vi.mocked(prisma.auditExportCursor.findUnique);
const upsertCursor = vi.mocked(prisma.auditExportCursor.upsert);
const findLogs = vi.mocked(prisma.auditLog.findMany);
const upload = vi.mocked(uploadJsonExport);

const NOW = new Date("2026-09-08T03:00:00.000Z");

describe("runAuditLogExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    upload.mockResolvedValue(undefined);
    upsertCursor.mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports the whole table on the first run (no cursor yet)", async () => {
    findCursor.mockResolvedValue(null);
    findLogs.mockResolvedValue([{ id: "log-1" }] as never);

    await runAuditLogExport();

    expect(findLogs).toHaveBeenCalledWith({
      where: { createdAt: { lte: NOW } },
      orderBy: { createdAt: "asc" },
    });
    expect(upload).toHaveBeenCalledWith(expect.stringContaining("audit-log-export_from-"), [
      { id: "log-1" },
    ]);
    expect(upsertCursor).toHaveBeenCalledWith({
      where: { id: "singleton" },
      create: { id: "singleton", lastExportedAt: NOW },
      update: { lastExportedAt: NOW },
    });
  });

  it("exports only rows created since the existing cursor", async () => {
    const lastExportedAt = new Date("2026-09-07T03:00:00.000Z");
    findCursor.mockResolvedValue({ id: "singleton", lastExportedAt, updatedAt: lastExportedAt });
    findLogs.mockResolvedValue([{ id: "log-2" }] as never);

    await runAuditLogExport();

    expect(findLogs).toHaveBeenCalledWith({
      where: { createdAt: { gt: lastExportedAt, lte: NOW } },
      orderBy: { createdAt: "asc" },
    });
  });

  it("skips the upload and leaves the cursor untouched when there are no new rows", async () => {
    findCursor.mockResolvedValue(null);
    findLogs.mockResolvedValue([]);

    await runAuditLogExport();

    expect(upload).not.toHaveBeenCalled();
    expect(upsertCursor).not.toHaveBeenCalled();
  });

  it("does not advance the cursor when the upload fails, so the next run retries the same rows", async () => {
    findCursor.mockResolvedValue(null);
    findLogs.mockResolvedValue([{ id: "log-1" }] as never);
    upload.mockRejectedValue(new Error("drive api down"));

    await expect(runAuditLogExport()).rejects.toThrow("drive api down");

    expect(upsertCursor).not.toHaveBeenCalled();
  });
});

describe("runAuditLogExport when Google Drive is not configured", () => {
  afterEach(() => {
    vi.doUnmock("../../config/env.js");
  });

  it("logs and returns without touching the database or Drive", async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock("../../config/env.js", () => ({ env: { isGoogleDriveConfigured: false } }));

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runAuditLogExport: run } = await import("../../jobs/auditLogExport.js");

    await run();

    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining("skipping export"));
    expect(findCursor).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();

    consoleLog.mockRestore();
  });
});
