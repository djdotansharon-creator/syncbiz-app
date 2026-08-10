-- CreateEnum
CREATE TYPE "EnrichmentScope" AS ENUM ('GENERAL', 'CLIENT', 'REVIEW', 'IGNORE');

-- AlterTable
ALTER TABLE "ChartSnapshot" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LocalTrackFile" ADD COLUMN     "availability" TEXT NOT NULL DEFAULT 'available',
ADD COLUMN     "displayComment" TEXT,
ADD COLUMN     "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "originalAlbum" TEXT,
ADD COLUMN     "originalArtists" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "originalBpm" DOUBLE PRECISION,
ADD COLUMN     "originalComments" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "originalCustomTags" JSONB,
ADD COLUMN     "originalGenres" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "originalIsrc" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "originalRating" DOUBLE PRECISION,
ADD COLUMN     "originalTitle" TEXT,
ADD COLUMN     "originalYear" INTEGER;

-- CreateTable
CREATE TABLE "TrackEnrichment" (
    "id" TEXT NOT NULL,
    "localFileId" TEXT NOT NULL,
    "myComment" TEXT,
    "myTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "genreOverride" TEXT,
    "bpmOverride" DOUBLE PRECISION,
    "ratingOverride" DOUBLE PRECISION,
    "manualSelected" BOOLEAN,
    "scope" "EnrichmentScope" NOT NULL DEFAULT 'REVIEW',
    "mood" TEXT,
    "energy" TEXT,
    "familiarity" TEXT,
    "businessType" TEXT,
    "daypart" TEXT,
    "clientEvent" TEXT,
    "includeInGeneralDjCreator" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "allowedOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultValue" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentTokenReview" (
    "id" TEXT NOT NULL,
    "rawToken" TEXT NOT NULL,
    "suggestedMeaning" TEXT,
    "category" TEXT NOT NULL DEFAULT 'needs_review',
    "confidence" TEXT NOT NULL DEFAULT 'low',
    "occurrences" INTEGER NOT NULL DEFAULT 0,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommentTokenReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackEnrichment_localFileId_key" ON "TrackEnrichment"("localFileId");

-- CreateIndex
CREATE INDEX "TrackEnrichment_scope_idx" ON "TrackEnrichment"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_name_key" ON "CustomFieldDefinition"("name");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_active_idx" ON "CustomFieldDefinition"("active");

-- CreateIndex
CREATE UNIQUE INDEX "CommentTokenReview_rawToken_key" ON "CommentTokenReview"("rawToken");

-- CreateIndex
CREATE INDEX "CommentTokenReview_category_idx" ON "CommentTokenReview"("category");

-- CreateIndex
CREATE INDEX "CommentTokenReview_approved_idx" ON "CommentTokenReview"("approved");

-- CreateIndex
CREATE INDEX "LocalTrackFile_availability_idx" ON "LocalTrackFile"("availability");

-- AddForeignKey
ALTER TABLE "TrackEnrichment" ADD CONSTRAINT "TrackEnrichment_localFileId_fkey" FOREIGN KEY ("localFileId") REFERENCES "LocalTrackFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
