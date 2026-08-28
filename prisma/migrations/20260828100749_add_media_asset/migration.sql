-- CreateEnum
CREATE TYPE "MediaProvider" AS ENUM ('R2', 'S3', 'B2', 'LOCAL_PREVIEW');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING', 'READY', 'RETIRED', 'FAILED');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "genreId" TEXT,
    "provider" "MediaProvider" NOT NULL DEFAULT 'R2',
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "contentHash" TEXT NOT NULL,
    "contentHashAlgorithm" TEXT NOT NULL DEFAULT 'sha256',
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING',
    "ingestSource" TEXT,
    "ingestExternalId" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_catalogItemId_idx" ON "MediaAsset"("catalogItemId");

-- CreateIndex
CREATE INDEX "MediaAsset_genreId_idx" ON "MediaAsset"("genreId");

-- CreateIndex
CREATE INDEX "MediaAsset_status_idx" ON "MediaAsset"("status");

-- CreateIndex
CREATE INDEX "MediaAsset_contentHash_idx" ON "MediaAsset"("contentHash");

-- CreateIndex
CREATE INDEX "MediaAsset_provider_status_idx" ON "MediaAsset"("provider", "status");

-- CreateIndex
CREATE INDEX "MediaAsset_ingestSource_ingestExternalId_idx" ON "MediaAsset"("ingestSource", "ingestExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_provider_bucket_objectKey_key" ON "MediaAsset"("provider", "bucket", "objectKey");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
