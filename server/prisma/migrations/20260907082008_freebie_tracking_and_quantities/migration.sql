-- CreateEnum
CREATE TYPE "FreebieEntryType" AS ENUM ('USE', 'VOID', 'RESTORE');

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "visitProcedureId" TEXT;

-- AlterTable
ALTER TABLE "procedures" ADD COLUMN     "allowQuantity" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "visit_procedures" ADD COLUMN     "coveredByFreebieId" TEXT,
ADD COLUMN     "items" JSONB,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "plan_freebies" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "procedureId" TEXT,
    "qtyIncluded" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_freebies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_freebie_entries" (
    "id" TEXT NOT NULL,
    "freebieId" TEXT NOT NULL,
    "type" "FreebieEntryType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT,
    "visitProcedureId" TEXT,
    "reversalOfId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_freebie_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_freebies_planId_idx" ON "plan_freebies"("planId");

-- CreateIndex
CREATE INDEX "plan_freebie_entries_freebieId_idx" ON "plan_freebie_entries"("freebieId");

-- AddForeignKey
ALTER TABLE "visit_procedures" ADD CONSTRAINT "visit_procedures_coveredByFreebieId_fkey" FOREIGN KEY ("coveredByFreebieId") REFERENCES "plan_freebies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_freebies" ADD CONSTRAINT "plan_freebies_planId_fkey" FOREIGN KEY ("planId") REFERENCES "treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_freebies" ADD CONSTRAINT "plan_freebies_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "procedures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_freebie_entries" ADD CONSTRAINT "plan_freebie_entries_freebieId_fkey" FOREIGN KEY ("freebieId") REFERENCES "plan_freebies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_freebie_entries" ADD CONSTRAINT "plan_freebie_entries_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_freebie_entries" ADD CONSTRAINT "plan_freebie_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "plan_freebie_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_visitProcedureId_fkey" FOREIGN KEY ("visitProcedureId") REFERENCES "visit_procedures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
