-- AlterTable
ALTER TABLE "complaints" ADD COLUMN     "orgUnitId" INTEGER;

-- AlterTable
ALTER TABLE "crew" ADD COLUMN     "orgUnitId" INTEGER;

-- AlterTable
ALTER TABLE "postings" ADD COLUMN     "orgUnitId" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "homeUnitId" INTEGER;

-- CreateTable
CREATE TABLE "org_units" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameHi" TEXT,
    "parentId" INTEGER,
    "depth" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "kindLabel" TEXT NOT NULL,
    "isLeaf" BOOLEAN NOT NULL DEFAULT true,
    "population" INTEGER,
    "centroidLat" DOUBLE PRECISION,
    "centroidLon" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_layers" (
    "id" SERIAL NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "namePlural" TEXT NOT NULL,
    "canDispatch" BOOLEAN NOT NULL DEFAULT false,
    "slaHours" INTEGER NOT NULL DEFAULT 48,
    "minPostings" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "department_layers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_units_code_key" ON "org_units"("code");

-- CreateIndex
CREATE INDEX "org_units_parentId_idx" ON "org_units"("parentId");

-- CreateIndex
CREATE INDEX "org_units_depth_idx" ON "org_units"("depth");

-- CreateIndex
CREATE INDEX "org_units_path_idx" ON "org_units"("path");

-- CreateIndex
CREATE UNIQUE INDEX "department_layers_departmentId_depth_key" ON "department_layers"("departmentId", "depth");

-- CreateIndex
CREATE INDEX "complaints_orgUnitId_status_idx" ON "complaints"("orgUnitId", "status");

-- CreateIndex
CREATE INDEX "postings_orgUnitId_departmentId_endedAt_idx" ON "postings"("orgUnitId", "departmentId", "endedAt");

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_layers" ADD CONSTRAINT "department_layers_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postings" ADD CONSTRAINT "postings_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_homeUnitId_fkey" FOREIGN KEY ("homeUnitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew" ADD CONSTRAINT "crew_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
