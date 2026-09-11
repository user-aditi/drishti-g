-- CreateEnum
CREATE TYPE "EscalationTrigger" AS ENUM ('SLA_BREACH', 'MANUAL');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'COMMISSIONER';

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "escalations" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "fromLevel" INTEGER NOT NULL,
    "toLevel" INTEGER NOT NULL,
    "trigger" "EscalationTrigger" NOT NULL,
    "reason" TEXT NOT NULL,
    "raisedById" INTEGER,
    "toUserId" INTEGER,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escalations_toUserId_at_idx" ON "escalations"("toUserId", "at");

-- CreateIndex
CREATE INDEX "escalations_at_idx" ON "escalations"("at");

-- CreateIndex
CREATE UNIQUE INDEX "escalations_requestId_toLevel_key" ON "escalations"("requestId", "toLevel");

-- CreateIndex
CREATE INDEX "service_requests_isImported_status_slaDueAt_idx" ON "service_requests"("isImported", "status", "slaDueAt");

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
