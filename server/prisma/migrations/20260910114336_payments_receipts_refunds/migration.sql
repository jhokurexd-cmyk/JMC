-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "balanceAfter" DECIMAL(10,2),
ADD COLUMN     "balanceBefore" DECIMAL(10,2),
ADD COLUMN     "receiptNo" TEXT,
ADD COLUMN     "refundMethod" "PaymentMethod",
ADD COLUMN     "reversalKind" TEXT;

-- CreateTable
CREATE TABLE "counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_receiptNo_key" ON "ledger_entries"("receiptNo");
