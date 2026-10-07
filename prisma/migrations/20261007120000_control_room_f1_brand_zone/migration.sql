-- Control Room F1 — Brand + Zone foundation (SHADOW). ADDITIVE ONLY: two new tables, three NULLABLE columns,
-- indexes and foreign keys. No existing column, row, id or constraint is changed. Nothing reads these for runtime
-- decisions in F1. Generated with `prisma migrate diff` (old schema → new schema) + the two raw partial indexes below.

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "brandId" TEXT;

-- AlterTable
ALTER TABLE "StationDevice" ADD COLUMN     "zoneId" TEXT;

-- AlterTable
ALTER TABLE "BranchMasterDesignation" ADD COLUMN     "zoneId" TEXT;

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "color" TEXT,
    "logoUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zoneTypeCode" TEXT NOT NULL DEFAULT 'MAIN',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Brand_workspaceId_idx" ON "Brand"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_workspaceId_code_key" ON "Brand"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "Zone_workspaceId_idx" ON "Zone"("workspaceId");

-- CreateIndex
CREATE INDEX "Zone_workspaceId_zoneTypeCode_idx" ON "Zone"("workspaceId", "zoneTypeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_branchId_code_key" ON "Zone"("branchId", "code");

-- CreateIndex
CREATE INDEX "Branch_brandId_idx" ON "Branch"("brandId");

-- CreateIndex
CREATE INDEX "StationDevice_zoneId_idx" ON "StationDevice"("zoneId");

-- CreateIndex
CREATE INDEX "BranchMasterDesignation_zoneId_idx" ON "BranchMasterDesignation"("zoneId");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationDevice" ADD CONSTRAINT "StationDevice_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchMasterDesignation" ADD CONSTRAINT "BranchMasterDesignation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Partial unique indexes (not expressible in Prisma — keep them when generating future migrations):
-- they guarantee AT MOST ONE default Brand per Workspace and AT MOST ONE default Zone per Location (Branch).
-- EXACTLY ONE default is guaranteed separately by the idempotent F1 backfill, transactional Location creation and
-- the F1 check script (scripts/control-room/f1-foundation.cjs).
CREATE UNIQUE INDEX "Brand_one_default_per_workspace" ON "Brand"("workspaceId") WHERE "isDefault";

CREATE UNIQUE INDEX "Zone_one_default_per_branch" ON "Zone"("branchId") WHERE "isDefault";
