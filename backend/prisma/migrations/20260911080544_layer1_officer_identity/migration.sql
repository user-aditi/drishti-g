-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('POSTING_RULE', 'SUPERVISOR');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'OFFICER';
ALTER TYPE "Role" ADD VALUE 'SUPERVISOR';

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedOfficerId" INTEGER;

-- CreateTable
CREATE TABLE "postings" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "orgUnitId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "officerId" INTEGER NOT NULL,
    "assignedById" INTEGER,
    "source" "AssignmentSource" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "issuedById" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "instructions" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "postings_agencyId_orgUnitId_endedAt_idx" ON "postings"("agencyId", "orgUnitId", "endedAt");

-- CreateIndex
CREATE INDEX "postings_userId_endedAt_idx" ON "postings"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "assignments_requestId_at_idx" ON "assignments"("requestId", "at");

-- CreateIndex
CREATE INDEX "assignments_officerId_at_idx" ON "assignments"("officerId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_code_key" ON "work_orders"("code");

-- CreateIndex
CREATE INDEX "work_orders_requestId_idx" ON "work_orders"("requestId");

-- CreateIndex
CREATE INDEX "work_orders_issuedById_completedAt_idx" ON "work_orders"("issuedById", "completedAt");

-- CreateIndex
CREATE INDEX "service_requests_assignedOfficerId_status_slaDueAt_idx" ON "service_requests"("assignedOfficerId", "status", "slaDueAt");

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
