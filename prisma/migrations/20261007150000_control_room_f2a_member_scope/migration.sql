-- Control Room F2a — MemberScope + MemberScopeTarget (SHADOW / OFFLINE ONLY). ADDITIVE ONLY: two new tables,
-- indexes, foreign keys and one CHECK constraint. No existing table, column, row or constraint is changed.
-- Nothing enforces these rows — current authorization stays authoritative. Generated with `prisma migrate diff`
-- (F1 schema → F2a schema) + the raw CHECK constraint below.

-- CreateTable
CREATE TABLE "MemberScope" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "allLocations" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberScopeTarget" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "brandId" TEXT,
    "branchId" TEXT,
    "zoneId" TEXT,
    "zoneTypeCode" TEXT,

    CONSTRAINT "MemberScopeTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberScope_workspaceId_userId_idx" ON "MemberScope"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberScope_memberId_source_sourceRef_key" ON "MemberScope"("memberId", "source", "sourceRef");

-- CreateIndex
CREATE INDEX "MemberScopeTarget_scopeId_idx" ON "MemberScopeTarget"("scopeId");

-- CreateIndex
CREATE INDEX "MemberScopeTarget_brandId_idx" ON "MemberScopeTarget"("brandId");

-- CreateIndex
CREATE INDEX "MemberScopeTarget_branchId_idx" ON "MemberScopeTarget"("branchId");

-- CreateIndex
CREATE INDEX "MemberScopeTarget_zoneId_idx" ON "MemberScopeTarget"("zoneId");

-- AddForeignKey
ALTER TABLE "MemberScope" ADD CONSTRAINT "MemberScope_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "WorkspaceMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberScopeTarget" ADD CONSTRAINT "MemberScopeTarget_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "MemberScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberScopeTarget" ADD CONSTRAINT "MemberScopeTarget_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberScopeTarget" ADD CONSTRAINT "MemberScopeTarget_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberScopeTarget" ADD CONSTRAINT "MemberScopeTarget_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Raw CHECK (not expressible in Prisma — keep it when generating future migrations): exactly ONE value column is set
-- and it matches the declared dimension. F3 replaces this constraint when it adds REGION / GROUP / TAG columns.
ALTER TABLE "MemberScopeTarget" ADD CONSTRAINT "MemberScopeTarget_one_value_matches_dimension" CHECK (
  num_nonnulls("brandId", "branchId", "zoneId", "zoneTypeCode") = 1
  AND (
    ("dimension" = 'BRAND' AND "brandId" IS NOT NULL)
    OR ("dimension" = 'LOCATION' AND "branchId" IS NOT NULL)
    OR ("dimension" = 'ZONE' AND "zoneId" IS NOT NULL)
    OR ("dimension" = 'ZONE_TYPE' AND "zoneTypeCode" IS NOT NULL)
  )
);

-- The three NO ACTION value FKs are DEFERRABLE INITIALLY DEFERRED (raw SQL; Prisma cannot express it): checked at
-- COMMIT, so a whole-workspace delete (which cascades members → scopes → targets AND branches / brands / zones in
-- one transaction, in no guaranteed order) succeeds, while deleting a single referenced Brand / Branch / Zone is still
-- refused (a referenced scope value can never silently disappear and broaden an AND row).
ALTER TABLE "MemberScopeTarget" ALTER CONSTRAINT "MemberScopeTarget_brandId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberScopeTarget" ALTER CONSTRAINT "MemberScopeTarget_branchId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberScopeTarget" ALTER CONSTRAINT "MemberScopeTarget_zoneId_fkey" DEFERRABLE INITIALLY DEFERRED;
