-- AlterTable
ALTER TABLE "complaint_categories" ADD COLUMN     "severity" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "complaints" ADD COLUMN     "clusterId" INTEGER,
ADD COLUMN     "priorityFactors" JSONB,
ADD COLUMN     "priorityScore" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "grievance_clusters" (
    "id" SERIAL NOT NULL,
    "sectorId" INTEGER,
    "categoryId" INTEGER,
    "label" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grievance_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grievance_clusters_sectorId_categoryId_isDismissed_idx" ON "grievance_clusters"("sectorId", "categoryId", "isDismissed");

-- CreateIndex
CREATE INDEX "complaints_clusterId_idx" ON "complaints"("clusterId");

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "grievance_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grievance_clusters" ADD CONSTRAINT "grievance_clusters_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grievance_clusters" ADD CONSTRAINT "grievance_clusters_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "complaint_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
