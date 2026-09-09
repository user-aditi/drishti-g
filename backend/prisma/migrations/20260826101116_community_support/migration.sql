-- AlterTable
ALTER TABLE "complaints" ADD COLUMN     "isCommunity" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "complaint_supports" (
    "id" SERIAL NOT NULL,
    "complaintId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_supports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "complaint_supports_complaintId_idx" ON "complaint_supports"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_supports_complaintId_userId_key" ON "complaint_supports"("complaintId", "userId");

-- AddForeignKey
ALTER TABLE "complaint_supports" ADD CONSTRAINT "complaint_supports_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_supports" ADD CONSTRAINT "complaint_supports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
