-- AlterTable
ALTER TABLE "UserMetadataContribution" ADD COLUMN     "catalogItemId" TEXT,
ADD COLUMN     "greatTrack" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "UserMetadataContribution_catalogItemId_idx" ON "UserMetadataContribution"("catalogItemId");
