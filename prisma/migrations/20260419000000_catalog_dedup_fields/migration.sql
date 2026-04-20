-- AlterTable: add dedup fields to CatalogItem
ALTER TABLE "CatalogItem" ADD COLUMN "canonicalUrl" TEXT;
ALTER TABLE "CatalogItem" ADD COLUMN "videoId" TEXT;
ALTER TABLE "CatalogItem" ADD COLUMN "provider" TEXT;

-- Backfill existing rows (all current rows are canonical youtube.com/watch?v= URLs)
UPDATE "CatalogItem"
SET
  "provider" = 'youtube',
  "canonicalUrl" = url,
  "videoId" = substring(url from 'v=([A-Za-z0-9_\-]+)')
WHERE url LIKE '%youtube.com/watch?v=%';

UPDATE "CatalogItem"
SET "provider" = 'soundcloud'
WHERE url LIKE '%soundcloud.com%' AND "provider" IS NULL;

UPDATE "CatalogItem"
SET "provider" = 'direct'
WHERE "provider" IS NULL;

-- CreateUniqueIndex on canonicalUrl (NULLs allowed — no conflict with unbackfilled rows)
CREATE UNIQUE INDEX "CatalogItem_canonicalUrl_key" ON "CatalogItem"("canonicalUrl");

-- CreateIndex on videoId for fast dedup lookups
CREATE INDEX "CatalogItem_videoId_idx" ON "CatalogItem"("videoId");
