-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- CreateTable
CREATE TABLE "risk_scores" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "orgUnitId" INTEGER NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL,
    "signals" JSONB NOT NULL,
    "factors" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "needsReview" BOOLEAN NOT NULL,
    "nextBreachRate" DOUBLE PRECISION,
    "outcome" BOOLEAN,
    "modelVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "risk_scores_month_agencyId_probability_idx" ON "risk_scores"("month", "agencyId", "probability");

-- CreateIndex
CREATE UNIQUE INDEX "risk_scores_modelVersion_agencyId_orgUnitId_month_key" ON "risk_scores"("modelVersion", "agencyId", "orgUnitId", "month");

-- AddForeignKey
ALTER TABLE "risk_scores" ADD CONSTRAINT "risk_scores_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_scores" ADD CONSTRAINT "risk_scores_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
