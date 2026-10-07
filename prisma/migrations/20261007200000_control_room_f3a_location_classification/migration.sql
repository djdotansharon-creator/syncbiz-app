-- Control Room F3a — Location classification foundation (SHADOW). ADDITIVE ONLY: 5 new tables, nullable Branch
-- columns, two nullable MemberScopeTarget columns, indexes, FKs, CHECKs. No existing id / row / column changes.
-- Region / LocationGroup / LocationTag are organization-level; a Tag is NOT a permission dimension (no tag column on
-- MemberScopeTarget). Generated with `prisma migrate diff` (F2a schema → F3a schema) + the raw SQL at the end.

-- AlterTable
ALTER TABLE "MemberScopeTarget" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "regionId" TEXT;

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "locationCode" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "regionId" TEXT,
ADD COLUMN     "stateProvince" TEXT;

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationGroupMember" (
    "groupId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "LocationGroupMember_pkey" PRIMARY KEY ("groupId","branchId")
);

-- CreateTable
CREATE TABLE "LocationTag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationTagAssignment" (
    "tagId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "LocationTagAssignment_pkey" PRIMARY KEY ("tagId","branchId")
);

-- CreateIndex
CREATE INDEX "Region_workspaceId_idx" ON "Region"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Region_workspaceId_code_key" ON "Region"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "LocationGroup_workspaceId_idx" ON "LocationGroup"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationGroup_workspaceId_code_key" ON "LocationGroup"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LocationGroup_id_workspaceId_key" ON "LocationGroup"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "LocationGroupMember_branchId_idx" ON "LocationGroupMember"("branchId");

-- CreateIndex
CREATE INDEX "LocationGroupMember_workspaceId_idx" ON "LocationGroupMember"("workspaceId");

-- CreateIndex
CREATE INDEX "LocationTag_workspaceId_idx" ON "LocationTag"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationTag_workspaceId_code_key" ON "LocationTag"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LocationTag_id_workspaceId_key" ON "LocationTag"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "LocationTagAssignment_branchId_idx" ON "LocationTagAssignment"("branchId");

-- CreateIndex
CREATE INDEX "LocationTagAssignment_workspaceId_idx" ON "LocationTagAssignment"("workspaceId");

-- CreateIndex
CREATE INDEX "MemberScopeTarget_regionId_idx" ON "MemberScopeTarget"("regionId");

-- CreateIndex
CREATE INDEX "MemberScopeTarget_groupId_idx" ON "MemberScopeTarget"("groupId");

-- CreateIndex
CREATE INDEX "Branch_regionId_idx" ON "Branch"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_workspaceId_locationCode_key" ON "Branch"("workspaceId", "locationCode");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_id_workspaceId_key" ON "Branch"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "MemberScopeTarget" ADD CONSTRAINT "MemberScopeTarget_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberScopeTarget" ADD CONSTRAINT "MemberScopeTarget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LocationGroup"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationGroup" ADD CONSTRAINT "LocationGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationGroupMember" ADD CONSTRAINT "LocationGroupMember_groupId_workspaceId_fkey" FOREIGN KEY ("groupId", "workspaceId") REFERENCES "LocationGroup"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationGroupMember" ADD CONSTRAINT "LocationGroupMember_branchId_workspaceId_fkey" FOREIGN KEY ("branchId", "workspaceId") REFERENCES "Branch"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTag" ADD CONSTRAINT "LocationTag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTagAssignment" ADD CONSTRAINT "LocationTagAssignment_tagId_workspaceId_fkey" FOREIGN KEY ("tagId", "workspaceId") REFERENCES "LocationTag"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTagAssignment" ADD CONSTRAINT "LocationTagAssignment_branchId_workspaceId_fkey" FOREIGN KEY ("branchId", "workspaceId") REFERENCES "Branch"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── raw SQL (not expressible in Prisma — keep it when generating future migrations) ──────────────────────────────
-- 1. Value FKs that must never silently disappear are NO ACTION + DEFERRABLE INITIALLY DEFERRED (checked at COMMIT):
--    deleting a single referenced Region / LocationGroup is refused; a whole-workspace cascade still succeeds.
ALTER TABLE "Branch" ALTER CONSTRAINT "Branch_regionId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberScopeTarget" ALTER CONSTRAINT "MemberScopeTarget_regionId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberScopeTarget" ALTER CONSTRAINT "MemberScopeTarget_groupId_fkey" DEFERRABLE INITIALLY DEFERRED;

-- 2. MemberScopeTarget CHECK — replaced atomically: exactly ONE value column set, matching the dimension.
--    Dimensions: BRAND, LOCATION, ZONE, ZONE_TYPE, REGION, GROUP. (No TAG — a Tag never affects access.)
ALTER TABLE "MemberScopeTarget" DROP CONSTRAINT "MemberScopeTarget_one_value_matches_dimension";
ALTER TABLE "MemberScopeTarget" ADD CONSTRAINT "MemberScopeTarget_one_value_matches_dimension" CHECK (
  num_nonnulls("brandId", "branchId", "zoneId", "zoneTypeCode", "regionId", "groupId") = 1
  AND (
    ("dimension" = 'BRAND' AND "brandId" IS NOT NULL)
    OR ("dimension" = 'LOCATION' AND "branchId" IS NOT NULL)
    OR ("dimension" = 'ZONE' AND "zoneId" IS NOT NULL)
    OR ("dimension" = 'ZONE_TYPE' AND "zoneTypeCode" IS NOT NULL)
    OR ("dimension" = 'REGION' AND "regionId" IS NOT NULL)
    OR ("dimension" = 'GROUP' AND "groupId" IS NOT NULL)
  )
);

-- 3. Canonical classification codes (stable import keys): ^[A-Z][A-Z0-9_]{0,39}$
ALTER TABLE "Region" ADD CONSTRAINT "Region_code_canonical" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,39}$');
ALTER TABLE "LocationGroup" ADD CONSTRAINT "LocationGroup_code_canonical" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,39}$');
ALTER TABLE "LocationTag" ADD CONSTRAINT "LocationTag_code_canonical" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,39}$');
