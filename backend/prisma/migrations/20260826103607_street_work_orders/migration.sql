-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('ISSUED', 'OPENED', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VerificationOutcome" AS ENUM ('AUTO_APPROVED', 'NEEDS_CITIZEN', 'NEEDS_OFFICER', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorkFileKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');

-- AlterTable
ALTER TABLE "complaints" ADD COLUMN     "citizenConfirmed" BOOLEAN,
ADD COLUMN     "citizenConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "citizenProofUrl" TEXT;

-- CreateTable
CREATE TABLE "crew" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "trade" "Trade" NOT NULL,
    "supervisorId" INTEGER NOT NULL,
    "sectorId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "contractorId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" SERIAL NOT NULL,
    "complaintId" INTEGER NOT NULL,
    "crewId" INTEGER,
    "code" TEXT NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'ISSUED',
    "instructions" TEXT,
    "issuedById" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_submissions" (
    "id" SERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "note" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_files" (
    "id" SERIAL NOT NULL,
    "submissionId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "WorkFileKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3),
    "exifLat" DOUBLE PRECISION,
    "exifLon" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" SERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "checks" JSONB NOT NULL,
    "outcome" "VerificationOutcome" NOT NULL,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crew_supervisorId_isActive_idx" ON "crew"("supervisorId", "isActive");

-- CreateIndex
CREATE INDEX "crew_sectorId_departmentId_trade_idx" ON "crew"("sectorId", "departmentId", "trade");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_code_key" ON "work_orders"("code");

-- CreateIndex
CREATE INDEX "work_orders_complaintId_idx" ON "work_orders"("complaintId");

-- CreateIndex
CREATE INDEX "work_orders_status_expiresAt_idx" ON "work_orders"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "work_submissions_workOrderId_idx" ON "work_submissions"("workOrderId");

-- CreateIndex
CREATE INDEX "work_files_submissionId_idx" ON "work_files"("submissionId");

-- CreateIndex
CREATE INDEX "work_files_contentHash_idx" ON "work_files"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "verifications_workOrderId_key" ON "verifications"("workOrderId");

-- CreateIndex
CREATE INDEX "verifications_outcome_idx" ON "verifications"("outcome");

-- AddForeignKey
ALTER TABLE "crew" ADD CONSTRAINT "crew_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew" ADD CONSTRAINT "crew_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew" ADD CONSTRAINT "crew_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew" ADD CONSTRAINT "crew_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_submissions" ADD CONSTRAINT "work_submissions_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_files" ADD CONSTRAINT "work_files_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "work_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
