-- Phase A1 — Universal Music Identity.
-- ADDITIVE ONLY: creates new enums + tables. It does NOT alter, backfill, or drop
-- any existing table (CatalogItem and all current data are untouched). The single
-- link to the legacy catalog is the nullable FK "UniversalTrack.legacyCatalogItemId"
-- (ON DELETE SET NULL), so this migration is fully reversible by dropping the new
-- objects. No ingestion is performed; the Charts/Trend tables are created empty.

-- CreateEnum
CREATE TYPE "TrackVersionType" AS ENUM ('ORIGINAL', 'RADIO_EDIT', 'EXTENDED', 'REMIX', 'LIVE', 'ACOUSTIC', 'INSTRUMENTAL', 'REMASTER', 'COVER', 'KARAOKE', 'SPED_UP', 'SLOWED', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderPlayableStatus" AS ENUM ('PLAYABLE', 'RESTRICTED', 'UNAVAILABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ChartType" AS ENUM ('TOP', 'VIRAL', 'DISCOVERY', 'GENRE', 'CITY');

-- CreateTable
CREATE TABLE "UniversalTrack" (
    "id" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "displayTitle" TEXT NOT NULL,
    "durationMs" INTEGER,
    "canonicalIsrc" TEXT,
    "versionType" "TrackVersionType",
    "firstReleaseDate" TIMESTAMP(3),
    "explicit" BOOLEAN,
    "legacyCatalogItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversalTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackArtist" (
    "id" TEXT NOT NULL,
    "universalTrackId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderMapping" (
    "id" TEXT NOT NULL,
    "universalTrackId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "providerIsrc" TEXT,
    "providerReleaseDate" TIMESTAMP(3),
    "playableStatus" "ProviderPlayableStatus" NOT NULL DEFAULT 'UNKNOWN',
    "matchConfidence" DOUBLE PRECISION,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceProvenance" (
    "id" TEXT NOT NULL,
    "universalTrackId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceType" TEXT,
    "externalReference" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawMetadataRef" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackRelease" (
    "id" TEXT NOT NULL,
    "universalTrackId" TEXT NOT NULL,
    "provider" TEXT,
    "albumTitle" TEXT,
    "releaseDate" TIMESTAMP(3),
    "label" TEXT,
    "artworkUrl" TEXT,
    "externalId" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartSnapshot" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chartType" "ChartType" NOT NULL,
    "territory" TEXT,
    "city" TEXT,
    "genre" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChartSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "universalTrackId" TEXT,
    "rank" INTEGER NOT NULL,
    "previousRank" INTEGER,
    "peakRank" INTEGER,
    "daysOnChart" INTEGER,
    "providerExternalId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChartEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSignal" (
    "id" TEXT NOT NULL,
    "universalTrackId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "territory" TEXT,
    "city" TEXT,
    "signalType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "provenance" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UniversalTrack_canonicalIsrc_key" ON "UniversalTrack"("canonicalIsrc");

-- CreateIndex
CREATE UNIQUE INDEX "UniversalTrack_legacyCatalogItemId_key" ON "UniversalTrack"("legacyCatalogItemId");

-- CreateIndex
CREATE INDEX "UniversalTrack_normalizedTitle_idx" ON "UniversalTrack"("normalizedTitle");

-- CreateIndex
CREATE INDEX "UniversalTrack_legacyCatalogItemId_idx" ON "UniversalTrack"("legacyCatalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_normalizedName_key" ON "Artist"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "TrackArtist_universalTrackId_artistId_key" ON "TrackArtist"("universalTrackId", "artistId");

-- CreateIndex
CREATE INDEX "TrackArtist_universalTrackId_idx" ON "TrackArtist"("universalTrackId");

-- CreateIndex
CREATE INDEX "TrackArtist_artistId_idx" ON "TrackArtist"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderMapping_provider_externalId_key" ON "ProviderMapping"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ProviderMapping_universalTrackId_idx" ON "ProviderMapping"("universalTrackId");

-- CreateIndex
CREATE INDEX "ProviderMapping_provider_idx" ON "ProviderMapping"("provider");

-- CreateIndex
CREATE INDEX "SourceProvenance_universalTrackId_idx" ON "SourceProvenance"("universalTrackId");

-- CreateIndex
CREATE INDEX "SourceProvenance_source_idx" ON "SourceProvenance"("source");

-- CreateIndex
CREATE INDEX "TrackRelease_universalTrackId_idx" ON "TrackRelease"("universalTrackId");

-- CreateIndex
CREATE INDEX "ChartSnapshot_source_chartType_idx" ON "ChartSnapshot"("source", "chartType");

-- CreateIndex
CREATE INDEX "ChartSnapshot_capturedAt_idx" ON "ChartSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "ChartSnapshot_territory_idx" ON "ChartSnapshot"("territory");

-- CreateIndex
CREATE INDEX "ChartEntry_snapshotId_idx" ON "ChartEntry"("snapshotId");

-- CreateIndex
CREATE INDEX "ChartEntry_universalTrackId_idx" ON "ChartEntry"("universalTrackId");

-- CreateIndex
CREATE INDEX "ChartEntry_snapshotId_rank_idx" ON "ChartEntry"("snapshotId", "rank");

-- CreateIndex
CREATE INDEX "TrendSignal_universalTrackId_idx" ON "TrendSignal"("universalTrackId");

-- CreateIndex
CREATE INDEX "TrendSignal_source_idx" ON "TrendSignal"("source");

-- CreateIndex
CREATE INDEX "TrendSignal_observedAt_idx" ON "TrendSignal"("observedAt");

-- AddForeignKey
ALTER TABLE "UniversalTrack" ADD CONSTRAINT "UniversalTrack_legacyCatalogItemId_fkey" FOREIGN KEY ("legacyCatalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackArtist" ADD CONSTRAINT "TrackArtist_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackArtist" ADD CONSTRAINT "TrackArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderMapping" ADD CONSTRAINT "ProviderMapping_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceProvenance" ADD CONSTRAINT "SourceProvenance_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackRelease" ADD CONSTRAINT "TrackRelease_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartEntry" ADD CONSTRAINT "ChartEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ChartSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartEntry" ADD CONSTRAINT "ChartEntry_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendSignal" ADD CONSTRAINT "TrendSignal_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
