-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "appliesToId" TEXT;

-- CreateIndex
CREATE INDEX "ledger_entries_appliesToId_idx" ON "ledger_entries"("appliesToId");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_appliesToId_fkey" FOREIGN KEY ("appliesToId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
