-- Stage 5.9 — CatalogSourceSnapshot (append-only source metadata) + manual editorial fields on CatalogItem.

-- CreateEnum
CREATE TYPE "CatalogSourceFetchStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "CatalogSourceFetchMethod" AS ENUM ('YOUTUBE_API', 'YTDLP', 'MANUAL', 'UNKNOWN');

-- AlterTable — manual editorial rating (not views/likes/popularity/automation)
ALTER TABLE "CatalogItem" ADD COLUMN "curationRating" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CatalogItem" ADD COLUMN "curationNotes" TEXT;

-- CreateTable
CREATE TABLE "CatalogSourceSnapshot" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "provider" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchStatus" "CatalogSourceFetchStatus" NOT NULL,
    "fetchMethod" "CatalogSourceFetchMethod" NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channelTitle" TEXT,
    "channelId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "viewCount" INTEGER,
    "likeCount" INTEGER,
    "commentCount" INTEGER,
    "durationSec" INTEGER,
    "thumbnail" TEXT,
    "rawJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogSourceSnapshot_catalogItemId_fetchedAt_idx" ON "CatalogSourceSnapshot"("catalogItemId", "fetchedAt" DESC);

-- AddForeignKey
ALTER TABLE "CatalogSourceSnapshot" ADD CONSTRAINT "CatalogSourceSnapshot_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
