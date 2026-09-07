import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { uploadJsonExport } from "./googleDrive.js";

const CURSOR_ID = "singleton";

function toFilenameTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * Exports AuditLog rows created since the last successful run to Google
 * Drive as one JSON file (passive backup only — no restore/import tooling
 * exists or is planned). The cursor (AuditExportCursor, a singleton row)
 * only advances after a successful upload, so a failed run is retried
 * (with overlap) on the next scheduled run instead of silently losing rows.
 */
export async function runAuditLogExport(): Promise<void> {
  if (!env.isGoogleDriveConfigured) {
    console.log(
      "[audit-export] GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_DRIVE_FOLDER_ID not set, skipping export",
    );
    return;
  }

  const runStartedAt = new Date();
  const cursor = await prisma.auditExportCursor.findUnique({ where: { id: CURSOR_ID } });
  const lastExportedAt = cursor?.lastExportedAt ?? undefined;

  const rows = await prisma.auditLog.findMany({
    where: {
      createdAt: {
        ...(lastExportedAt ? { gt: lastExportedAt } : {}),
        lte: runStartedAt,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (rows.length === 0) {
    console.log("[audit-export] no new AuditLog rows since last export, skipping upload");
    return;
  }

  const filename = `audit-log-export_from-${toFilenameTimestamp(lastExportedAt ?? new Date(0))}_to-${toFilenameTimestamp(runStartedAt)}.json`;
  await uploadJsonExport(filename, rows);

  await prisma.auditExportCursor.upsert({
    where: { id: CURSOR_ID },
    create: { id: CURSOR_ID, lastExportedAt: runStartedAt },
    update: { lastExportedAt: runStartedAt },
  });

  console.log(`[audit-export] exported ${rows.length} AuditLog row(s) to Drive as ${filename}`);
}
