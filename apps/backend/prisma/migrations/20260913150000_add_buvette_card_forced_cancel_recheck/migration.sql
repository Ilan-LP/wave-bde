-- AlterTable
ALTER TABLE "BuvetteCardCheckout" ADD COLUMN     "forcedCancelAt" TIMESTAMP(3),
ADD COLUMN     "forcedCancelRecheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "BuvetteCardCheckout_status_forcedCancelAt_forcedCancelRech_idx" ON "BuvetteCardCheckout"("status", "forcedCancelAt", "forcedCancelRecheckedAt");
