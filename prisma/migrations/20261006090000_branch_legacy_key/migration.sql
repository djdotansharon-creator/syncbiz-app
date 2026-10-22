-- Control Room Phase 1 / Gate 1 (additive, nullable): legacy runtime branch key for the canonical Branch row.
-- NULLs are distinct in a Postgres unique index, so existing branches (legacyKey NULL) never conflict.
ALTER TABLE "Branch" ADD COLUMN "legacyKey" TEXT;

CREATE UNIQUE INDEX "Branch_workspaceId_legacyKey_key" ON "Branch"("workspaceId", "legacyKey");
