-- AlterTable
ALTER TABLE "escalations" ADD COLUMN     "acknowledgeNote" TEXT,
ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedById" INTEGER,
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
