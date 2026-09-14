-- CreateTable
CREATE TABLE "BuvetteCashSale" (
    "id" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "amountPoints" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuvetteCashSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuvetteCashSale_createdAt_idx" ON "BuvetteCashSale"("createdAt");
