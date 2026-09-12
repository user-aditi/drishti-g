-- CreateEnum
CREATE TYPE "ProofOutcome" AS ENUM ('REJECTED', 'NEEDS_CITIZEN', 'NEEDS_OFFICER', 'CONFIRMED');

-- CreateTable
CREATE TABLE "work_photos" (
    "id" SERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "dHash" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "capturedAt" TIMESTAMP(3),
    "exifLat" DOUBLE PRECISION,
    "exifLng" DOUBLE PRECISION,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_proofs" (
    "id" SERIAL NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "checks" JSONB NOT NULL,
    "outcome" "ProofOutcome" NOT NULL,
    "citizenVerdict" BOOLEAN,
    "citizenAt" TIMESTAMP(3),
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_photos_storedName_key" ON "work_photos"("storedName");

-- CreateIndex
CREATE INDEX "work_photos_workOrderId_idx" ON "work_photos"("workOrderId");

-- CreateIndex
CREATE INDEX "work_photos_sha256_idx" ON "work_photos"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "work_proofs_workOrderId_key" ON "work_proofs"("workOrderId");

-- CreateIndex
CREATE INDEX "work_proofs_outcome_updatedAt_idx" ON "work_proofs"("outcome", "updatedAt");

-- AddForeignKey
ALTER TABLE "work_photos" ADD CONSTRAINT "work_photos_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
