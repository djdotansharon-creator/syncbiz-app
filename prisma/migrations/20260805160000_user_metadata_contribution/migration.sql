-- User metadata SUGGESTIONS (PENDING). Never edits the official catalog or any music file.
-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "UserMetadataContribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT,
    "trackPublicId" TEXT NOT NULL,
    "trackTitle" TEXT,
    "trackArtist" TEXT,
    "genre" TEXT,
    "mood" TEXT,
    "energy" TEXT,
    "daypart" TEXT,
    "businessType" TEXT,
    "publicTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "status" "ContributionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    CONSTRAINT "UserMetadataContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMetadataContribution_status_idx" ON "UserMetadataContribution"("status");
CREATE INDEX "UserMetadataContribution_userId_idx" ON "UserMetadataContribution"("userId");
CREATE INDEX "UserMetadataContribution_trackPublicId_idx" ON "UserMetadataContribution"("trackPublicId");
