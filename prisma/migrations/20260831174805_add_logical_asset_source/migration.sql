-- CreateTable
CREATE TABLE "LogicalAssetSource" (
    "id" TEXT NOT NULL,
    "logicalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogicalAssetSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogicalAssetSource_logicalId_idx" ON "LogicalAssetSource"("logicalId");

-- CreateIndex
CREATE INDEX "LogicalAssetSource_logicalId_isCurrent_idx" ON "LogicalAssetSource"("logicalId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "LogicalAssetSource_source_externalId_key" ON "LogicalAssetSource"("source", "externalId");

-- Partial UNIQUE: at most ONE current source mapping per logicalId. Historical mappings (isCurrent=false)
-- are kept for provenance and can coexist. (Prisma cannot express a filtered unique index in-schema,
-- so it is added here as raw SQL — same pattern as MediaAsset_logicalId_ready_key.)
CREATE UNIQUE INDEX "LogicalAssetSource_logicalId_current_key"
  ON "LogicalAssetSource"("logicalId")
  WHERE "isCurrent";
