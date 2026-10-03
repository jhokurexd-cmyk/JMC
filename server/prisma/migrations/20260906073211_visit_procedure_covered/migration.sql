-- AlterTable
ALTER TABLE "visit_procedures" ADD COLUMN     "coveredByPlanId" TEXT;

-- AddForeignKey
ALTER TABLE "visit_procedures" ADD CONSTRAINT "visit_procedures_coveredByPlanId_fkey" FOREIGN KEY ("coveredByPlanId") REFERENCES "treatment_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
