-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CITIZEN', 'AGENT');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'ASSIGNED', 'STARTED', 'IN_PROGRESS', 'PENDING', 'CLOSED', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('PHONE', 'ONLINE', 'MOBILE', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SlaSource" AS ENUM ('PUBLISHED', 'DERIVED_P75');

-- CreateTable
CREATE TABLE "org_units" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" INTEGER,
    "depth" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "kindLabel" TEXT NOT NULL,
    "isLeaf" BOOLEAN NOT NULL DEFAULT true,
    "centroidLat" DOUBLE PRECISION,
    "centroidLon" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_types" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "slaHours" DOUBLE PRECISION NOT NULL,
    "slaSource" "SlaSource" NOT NULL DEFAULT 'DERIVED_P75',
    "slaNote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_descriptors" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "requestTypeId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_descriptors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" SERIAL NOT NULL,
    "srNumber" TEXT NOT NULL,
    "citizenId" INTEGER,
    "typeId" INTEGER NOT NULL,
    "descriptorId" INTEGER,
    "agencyId" INTEGER NOT NULL,
    "orgUnitId" INTEGER,
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "channel" "Channel" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "address" TEXT,
    "zip" TEXT,
    "councilDistrict" TEXT,
    "policePrecinct" TEXT,
    "resolutionNote" TEXT,
    "isImported" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_status_history" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "fromStatus" "RequestStatus",
    "toStatus" "RequestStatus" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "actorId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CITIZEN',
    "agencyId" INTEGER,
    "orgUnitId" INTEGER,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'api',
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "agencies_code_key" ON "agencies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "request_types_code_key" ON "request_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "request_types_name_key" ON "request_types"("name");

-- CreateIndex
CREATE INDEX "request_types_agencyId_idx" ON "request_types"("agencyId");

-- CreateIndex
CREATE INDEX "request_descriptors_requestTypeId_idx" ON "request_descriptors"("requestTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "request_descriptors_requestTypeId_name_key" ON "request_descriptors"("requestTypeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_srNumber_key" ON "service_requests"("srNumber");

-- CreateIndex
CREATE INDEX "service_requests_agencyId_status_createdAt_idx" ON "service_requests"("agencyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "service_requests_orgUnitId_status_idx" ON "service_requests"("orgUnitId", "status");

-- CreateIndex
CREATE INDEX "service_requests_typeId_status_idx" ON "service_requests"("typeId", "status");

-- CreateIndex
CREATE INDEX "service_requests_citizenId_idx" ON "service_requests"("citizenId");

-- CreateIndex
CREATE INDEX "service_requests_status_slaDueAt_idx" ON "service_requests"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "service_requests_createdAt_idx" ON "service_requests"("createdAt");

-- CreateIndex
CREATE INDEX "request_status_history_requestId_at_idx" ON "request_status_history"("requestId", "at");

-- CreateIndex
CREATE INDEX "request_status_history_actorId_idx" ON "request_status_history"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_agencyId_idx" ON "users"("agencyId");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_prevHash_key" ON "audit_events"("prevHash");

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_descriptors" ADD CONSTRAINT "request_descriptors_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "request_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_citizenId_fkey" FOREIGN KEY ("citizenId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "request_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_descriptorId_fkey" FOREIGN KEY ("descriptorId") REFERENCES "request_descriptors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
