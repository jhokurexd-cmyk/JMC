-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "reversalOfId" TEXT;

-- AlterTable
ALTER TABLE "visit_procedures" ADD COLUMN     "performedBy" TEXT;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "appointmentId" TEXT;

-- CreateIndex
CREATE INDEX "ledger_entries_reversalOfId_idx" ON "ledger_entries"("reversalOfId");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
