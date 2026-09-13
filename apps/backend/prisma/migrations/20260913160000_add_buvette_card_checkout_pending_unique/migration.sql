-- Partial unique index: at most one PENDING BuvetteCardCheckout per readerId.
-- Not expressible in schema.prisma (Prisma has no partial/filtered unique
-- index syntax as of 6.x) — hand-written, same as the forcedCancelAt/
-- forcedCancelRecheckedAt migration before it. This is the real enforcement
-- point for "no two concurrent PENDING checkouts on the same reader"; the
-- existing findFirst pre-check in POST /buvette/card/checkout is only a fast
-- path, since that read and the later create are not atomic together.
--
-- Purely additive: only rejects a write that would produce a second PENDING
-- row for a readerId already holding one. Any number of terminal
-- (SUCCESSFUL/FAILED/CANCELLED) rows per reader are untouched, and no
-- existing row is validated, modified, or backfilled by creating this index.
CREATE UNIQUE INDEX "BuvetteCardCheckout_readerId_pending_key"
ON "BuvetteCardCheckout" ("readerId")
WHERE "status" = 'PENDING';
