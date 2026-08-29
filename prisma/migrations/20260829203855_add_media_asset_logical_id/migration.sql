-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "logicalId" TEXT;

-- CreateIndex
CREATE INDEX "MediaAsset_logicalId_idx" ON "MediaAsset"("logicalId");

-- CreateIndex
CREATE INDEX "MediaAsset_logicalId_status_idx" ON "MediaAsset"("logicalId", "status");

-- Partial UNIQUE: at most ONE READY physical version per logical id. This is the DB-level guarantee
-- behind the versioning model — a content replacement can keep the old row (RETIRED) and add the new
-- one (READY), and the two can coexist, but two READY rows for the same logicalId are impossible.
-- (Prisma cannot express a partial/filtered unique index in-schema, so it is added here as raw SQL.)
CREATE UNIQUE INDEX "MediaAsset_logicalId_ready_key"
  ON "MediaAsset"("logicalId")
  WHERE "status" = 'READY' AND "logicalId" IS NOT NULL;
