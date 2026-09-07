-- AlterTable
ALTER TABLE "PointsAccount" ADD COLUMN     "qrToken" TEXT,
ADD COLUMN     "qrTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "PointsAccount_qrToken_key" ON "PointsAccount"("qrToken");
