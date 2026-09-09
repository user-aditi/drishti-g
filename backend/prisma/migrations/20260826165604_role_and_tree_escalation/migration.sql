-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CITIZEN', 'OFFICER', 'SUPER_ADMIN');

-- AlterTable
ALTER TABLE "escalations" ADD COLUMN     "fromUnitId" INTEGER,
ADD COLUMN     "toUnitId" INTEGER,
ALTER COLUMN "fromRank" DROP NOT NULL,
ALTER COLUMN "toRank" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'CITIZEN';

-- CreateIndex
CREATE INDEX "escalations_toUnitId_idx" ON "escalations"("toUnitId");

-- CreateIndex
CREATE INDEX "users_role_isActive_idx" ON "users"("role", "isActive");
