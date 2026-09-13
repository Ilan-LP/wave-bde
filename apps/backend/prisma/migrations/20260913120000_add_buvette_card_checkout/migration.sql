-- CreateEnum
CREATE TYPE "BuvetteCardCheckoutStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BuvetteCardCheckout" (
    "id" TEXT NOT NULL,
    "readerId" TEXT NOT NULL,
    "clientTransactionId" TEXT NOT NULL,
    "amountPoints" INTEGER NOT NULL,
    "amountMinorUnit" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "BuvetteCardCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "cancelRequestedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "BuvetteCardCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuvetteCardCheckout_clientTransactionId_key" ON "BuvetteCardCheckout"("clientTransactionId");

-- CreateIndex
CREATE INDEX "BuvetteCardCheckout_readerId_status_idx" ON "BuvetteCardCheckout"("readerId", "status");

-- CreateIndex
CREATE INDEX "BuvetteCardCheckout_createdAt_idx" ON "BuvetteCardCheckout"("createdAt");
