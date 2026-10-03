-- CreateEnum
CREATE TYPE "PlanPaymentType" AS ENUM ('CASH', 'INSTALLMENT');

-- AlterEnum
ALTER TYPE "PlanStatus" ADD VALUE 'PAID';

-- AlterTable
ALTER TABLE "treatment_plans" ADD COLUMN     "paymentType" "PlanPaymentType" NOT NULL DEFAULT 'CASH';
