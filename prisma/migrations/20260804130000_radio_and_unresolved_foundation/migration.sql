-- Phase B0.3 + B0.4 — Unresolved ingestion + Radio Intelligence foundation.
-- ADDITIVE ONLY: new enums + tables, plus FKs that reference the (also-new) UniversalTrack.
-- It does NOT alter, backfill, or drop any existing table. No ingestion is performed;
-- every table is created empty. Reversible by dropping the new objects.

-- CreateEnum
CREATE TYPE "ExternalMatchStatus" AS ENUM ('PENDING', 'MATCHED', 'AMBIGUOUS', 'REJECTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "StationPlaylistType" AS ENUM ('EDITORIAL', 'A_LIST', 'B_LIST', 'C_LIST', 'ROTATION');

-- CreateTable
CREATE TABLE "ExternalTrackObservation" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceTrackId" TEXT,
    "sourceUrl" TEXT,
    "rawTitle" TEXT NOT NULL,
    "rawArtists" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawAlbum" TEXT,
    "rawIsrc" TEXT,
    "rawDurationMs" INTEGER,
    "rawReleaseDate" TIMESTAMP(3),
    "territory" TEXT,
    "city" TEXT,
    "genre" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "rawMetadata" JSONB,
    "matchStatus" "ExternalMatchStatus" NOT NULL DEFAULT 'PENDING',
    "matchedUniversalTrackId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "matchMethod" TEXT,
    "matchReasons" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalTrackObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadioStation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "market" TEXT,
    "stationFormat" TEXT,
    "externalIds" JSONB,
    "source" TEXT,
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadioStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadioAirplayEvent" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "universalTrackId" TEXT,
    "externalObservationId" TEXT,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "matchConfidence" DOUBLE PRECISION,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadioAirplayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationPlaylistSnapshot" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "playlistType" "StationPlaylistType" NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationPlaylistSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationPlaylistEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "universalTrackId" TEXT,
    "externalObservationId" TEXT,
    "position" INTEGER,
    "rotationLevel" TEXT,
    "addedAt" TIMESTAMP(3),
    "matchConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationPlaylistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalTrackObservation_source_idx" ON "ExternalTrackObservation"("source");

-- CreateIndex
CREATE INDEX "ExternalTrackObservation_matchStatus_idx" ON "ExternalTrackObservation"("matchStatus");

-- CreateIndex
CREATE INDEX "ExternalTrackObservation_matchedUniversalTrackId_idx" ON "ExternalTrackObservation"("matchedUniversalTrackId");

-- CreateIndex
CREATE INDEX "ExternalTrackObservation_observedAt_idx" ON "ExternalTrackObservation"("observedAt");

-- CreateIndex
CREATE INDEX "ExternalTrackObservation_rawIsrc_idx" ON "ExternalTrackObservation"("rawIsrc");

-- CreateIndex
CREATE INDEX "RadioStation_country_idx" ON "RadioStation"("country");

-- CreateIndex
CREATE INDEX "RadioStation_name_idx" ON "RadioStation"("name");

-- CreateIndex
CREATE INDEX "RadioAirplayEvent_stationId_idx" ON "RadioAirplayEvent"("stationId");

-- CreateIndex
CREATE INDEX "RadioAirplayEvent_universalTrackId_idx" ON "RadioAirplayEvent"("universalTrackId");

-- CreateIndex
CREATE INDEX "RadioAirplayEvent_playedAt_idx" ON "RadioAirplayEvent"("playedAt");

-- CreateIndex
CREATE INDEX "RadioAirplayEvent_externalObservationId_idx" ON "RadioAirplayEvent"("externalObservationId");

-- CreateIndex
CREATE INDEX "StationPlaylistSnapshot_stationId_capturedAt_idx" ON "StationPlaylistSnapshot"("stationId", "capturedAt");

-- CreateIndex
CREATE INDEX "StationPlaylistSnapshot_playlistType_idx" ON "StationPlaylistSnapshot"("playlistType");

-- CreateIndex
CREATE INDEX "StationPlaylistEntry_snapshotId_idx" ON "StationPlaylistEntry"("snapshotId");

-- CreateIndex
CREATE INDEX "StationPlaylistEntry_universalTrackId_idx" ON "StationPlaylistEntry"("universalTrackId");

-- CreateIndex
CREATE INDEX "StationPlaylistEntry_externalObservationId_idx" ON "StationPlaylistEntry"("externalObservationId");

-- AddForeignKey
ALTER TABLE "ExternalTrackObservation" ADD CONSTRAINT "ExternalTrackObservation_matchedUniversalTrackId_fkey" FOREIGN KEY ("matchedUniversalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadioAirplayEvent" ADD CONSTRAINT "RadioAirplayEvent_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "RadioStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadioAirplayEvent" ADD CONSTRAINT "RadioAirplayEvent_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationPlaylistSnapshot" ADD CONSTRAINT "StationPlaylistSnapshot_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "RadioStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationPlaylistEntry" ADD CONSTRAINT "StationPlaylistEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "StationPlaylistSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationPlaylistEntry" ADD CONSTRAINT "StationPlaylistEntry_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
