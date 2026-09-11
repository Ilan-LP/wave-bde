-- CreateEnum
CREATE TYPE "RechargeCheckoutStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "RechargeCheckout" (
    "id" TEXT NOT NULL,
    "pointsAccountId" TEXT NOT NULL,
    "sumupCheckoutId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "amountMinorUnit" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RechargeCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "RechargeCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RechargeCheckout_sumupCheckoutId_key" ON "RechargeCheckout"("sumupCheckoutId");

-- CreateIndex
CREATE INDEX "RechargeCheckout_pointsAccountId_createdAt_idx" ON "RechargeCheckout"("pointsAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "RechargeCheckout" ADD CONSTRAINT "RechargeCheckout_pointsAccountId_fkey" FOREIGN KEY ("pointsAccountId") REFERENCES "PointsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
