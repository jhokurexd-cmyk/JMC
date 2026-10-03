-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'CONFIRMED' BEFORE 'ARRIVED';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dentist" TEXT;
