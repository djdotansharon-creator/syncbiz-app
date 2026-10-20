-- Jingles Stage 1 (owner 2026-10-12): origin + audience. ADDITIVE ONLY — nullable columns + one index.
-- "Announcement"."branchId" is NOT touched (legacy; stays NOT NULL DEFAULT 'default').
ALTER TABLE "Announcement" ADD COLUMN "originBranchId" TEXT;
ALTER TABLE "Announcement" ADD COLUMN "audience" TEXT;
ALTER TABLE "Announcement" ADD COLUMN "audienceBranchId" TEXT;
ALTER TABLE "Announcement" ADD COLUMN "audienceBrandId" TEXT;
ALTER TABLE "Announcement" ADD COLUMN "audienceRegion" TEXT;

CREATE INDEX "Announcement_workspaceId_audience_idx" ON "Announcement"("workspaceId", "audience");
