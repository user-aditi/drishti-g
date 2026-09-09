-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('CATEGORY', 'ROUTE', 'PRIORITY', 'NEXT_ACTION');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('PENDING', 'CONFIRMED', 'OVERRIDDEN', 'AUTO_EXECUTED');

-- CreateTable
CREATE TABLE "decisions" (
    "id" SERIAL NOT NULL,
    "kind" "DecisionKind" NOT NULL,
    "complaintId" INTEGER NOT NULL,
    "chosen" TEXT NOT NULL,
    "alternatives" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "feasibleSet" JSONB,
    "reasons" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'gcce',
    "actorId" INTEGER,
    "outcome" "DecisionOutcome" NOT NULL DEFAULT 'PENDING',
    "overriddenTo" TEXT,
    "overriddenById" INTEGER,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decisions_kind_outcome_idx" ON "decisions"("kind", "outcome");

-- CreateIndex
CREATE INDEX "decisions_complaintId_idx" ON "decisions"("complaintId");

-- CreateIndex
CREATE INDEX "decisions_createdAt_idx" ON "decisions"("createdAt");

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

