-- Phase C — Local Library Sync + ProviderMapping version/matchMethod.
-- ADDITIVE: new nullable columns + two new tables. No existing table is dropped/backfilled.

-- AlterTable: ProviderMapping — version + matchMethod (both nullable)
ALTER TABLE "ProviderMapping" ADD COLUMN "version" "TrackVersionType";
ALTER TABLE "ProviderMapping" ADD COLUMN "matchMethod" TEXT;

-- AlterTable: UniversalTrack — field-level metadata provenance (JSON)
ALTER TABLE "UniversalTrack" ADD COLUMN "metadataProvenance" JSONB;

-- CreateTable
CREATE TABLE "LocalLibrarySource" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalLibrarySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalTrackFile" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "localRef" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileSize" INTEGER,
    "modifiedAt" TIMESTAMP(3),
    "metadataHash" TEXT,
    "universalTrackId" TEXT,
    "lastScannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalTrackFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalLibrarySource_deviceId_key" ON "LocalLibrarySource"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalTrackFile_sourceId_localRef_key" ON "LocalTrackFile"("sourceId", "localRef");

-- CreateIndex
CREATE INDEX "LocalTrackFile_universalTrackId_idx" ON "LocalTrackFile"("universalTrackId");

-- CreateIndex
CREATE INDEX "LocalTrackFile_status_idx" ON "LocalTrackFile"("status");

-- AddForeignKey
ALTER TABLE "LocalTrackFile" ADD CONSTRAINT "LocalTrackFile_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LocalLibrarySource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalTrackFile" ADD CONSTRAINT "LocalTrackFile_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
