-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "socialMedia" JSONB;

-- AlterTable
ALTER TABLE "treatment_plans" ADD COLUMN     "freebies" JSONB;

-- CreateTable
CREATE TABLE "patient_files" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'XRAY',
    "label" TEXT,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_files_patientId_createdAt_idx" ON "patient_files"("patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "patient_files" ADD CONSTRAINT "patient_files_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
