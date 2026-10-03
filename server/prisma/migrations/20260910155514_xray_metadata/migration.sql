-- AlterTable
ALTER TABLE "patient_files" ADD COLUMN     "description" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "takenAt" DATE,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "xrayType" TEXT;
