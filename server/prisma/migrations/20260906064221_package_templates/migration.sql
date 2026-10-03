-- AlterTable
ALTER TABLE "treatment_plans" ADD COLUMN     "includedProcedures" JSONB,
ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "package_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paymentType" "PlanPaymentType" NOT NULL DEFAULT 'INSTALLMENT',
    "defaultPrice" DECIMAL(10,2) NOT NULL,
    "downpayment" DECIMAL(10,2),
    "monthlyDue" DECIMAL(10,2),
    "freebies" JSONB,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_procedures" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,

    CONSTRAINT "package_procedures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "package_procedures_templateId_procedureId_key" ON "package_procedures"("templateId", "procedureId");

-- AddForeignKey
ALTER TABLE "package_procedures" ADD CONSTRAINT "package_procedures_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "package_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_procedures" ADD CONSTRAINT "package_procedures_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "procedures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "package_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
