-- CreateEnum
CREATE TYPE "IdentityAssurance" AS ENUM ('NONE', 'DEVICE_BOUND', 'OTP_VERIFIED');

-- AlterTable
ALTER TABLE "work_files" ADD COLUMN     "isSelfie" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "boundAt" TIMESTAMP(3),
ADD COLUMN     "boundDeviceHash" TEXT;

-- AlterTable
ALTER TABLE "work_submissions" ADD COLUMN     "identityAssurance" "IdentityAssurance" NOT NULL DEFAULT 'NONE';
