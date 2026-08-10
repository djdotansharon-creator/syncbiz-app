-- Phase C MVP — UniversalPlaylist + items + export history.
-- ADDITIVE ONLY: new enums + tables + FKs to existing UniversalTrack / Playlist.
-- Does NOT alter or drop Playlist/PlaylistItem or any existing table.

-- CreateEnum
CREATE TYPE "UniversalPlaylistSourceType" AS ENUM ('IMPORTED_URL', 'LOCAL_M3U', 'DJ_CREATOR');

-- CreateEnum
CREATE TYPE "UniversalPlaylistItemStatus" AS ENUM ('RESOLVED', 'AMBIGUOUS', 'UNRESOLVED', 'MISSING');

-- CreateEnum
CREATE TYPE "PlaylistExportTarget" AS ENUM ('SYNCBIZ', 'YOUTUBE', 'SPOTIFY');

-- CreateEnum
CREATE TYPE "PlaylistExportStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "UniversalPlaylist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceProvider" TEXT NOT NULL,
    "sourceType" "UniversalPlaylistSourceType" NOT NULL,
    "sourcePlaylistId" TEXT,
    "sourceUrl" TEXT,
    "sourceKey" TEXT NOT NULL,
    "totalDurationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversalPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniversalPlaylistItem" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "universalTrackId" TEXT,
    "rawTitle" TEXT NOT NULL,
    "rawArtists" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawDurationMs" INTEGER,
    "sourceExternalId" TEXT,
    "sourceRef" TEXT,
    "filename" TEXT,
    "status" "UniversalPlaylistItemStatus" NOT NULL,
    "matchConfidence" DOUBLE PRECISION,
    "matchMethod" TEXT,
    "matchReasons" JSONB,
    "bpm" DOUBLE PRECISION,
    "comment" TEXT,
    "rating" DOUBLE PRECISION,
    "isrc" TEXT,
    "metadataHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversalPlaylistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniversalPlaylistExport" (
    "id" TEXT NOT NULL,
    "universalPlaylistId" TEXT NOT NULL,
    "target" "PlaylistExportTarget" NOT NULL,
    "targetExternalId" TEXT,
    "syncbizPlaylistId" TEXT,
    "status" "PlaylistExportStatus" NOT NULL DEFAULT 'RUNNING',
    "tracksTotal" INTEGER NOT NULL DEFAULT 0,
    "tracksExported" INTEGER NOT NULL DEFAULT 0,
    "tracksMissing" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniversalPlaylistExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UniversalPlaylist_sourceKey_key" ON "UniversalPlaylist"("sourceKey");

-- CreateIndex
CREATE INDEX "UniversalPlaylist_sourceProvider_idx" ON "UniversalPlaylist"("sourceProvider");

-- CreateIndex
CREATE INDEX "UniversalPlaylist_sourceType_idx" ON "UniversalPlaylist"("sourceType");

-- CreateIndex
CREATE INDEX "UniversalPlaylistItem_playlistId_idx" ON "UniversalPlaylistItem"("playlistId");

-- CreateIndex
CREATE INDEX "UniversalPlaylistItem_playlistId_position_idx" ON "UniversalPlaylistItem"("playlistId", "position");

-- CreateIndex
CREATE INDEX "UniversalPlaylistItem_universalTrackId_idx" ON "UniversalPlaylistItem"("universalTrackId");

-- CreateIndex
CREATE INDEX "UniversalPlaylistItem_status_idx" ON "UniversalPlaylistItem"("status");

-- CreateIndex
CREATE INDEX "UniversalPlaylistExport_universalPlaylistId_idx" ON "UniversalPlaylistExport"("universalPlaylistId");

-- CreateIndex
CREATE INDEX "UniversalPlaylistExport_target_idx" ON "UniversalPlaylistExport"("target");

-- CreateIndex
CREATE INDEX "UniversalPlaylistExport_syncbizPlaylistId_idx" ON "UniversalPlaylistExport"("syncbizPlaylistId");

-- AddForeignKey
ALTER TABLE "UniversalPlaylistItem" ADD CONSTRAINT "UniversalPlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "UniversalPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniversalPlaylistItem" ADD CONSTRAINT "UniversalPlaylistItem_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniversalPlaylistExport" ADD CONSTRAINT "UniversalPlaylistExport_universalPlaylistId_fkey" FOREIGN KEY ("universalPlaylistId") REFERENCES "UniversalPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniversalPlaylistExport" ADD CONSTRAINT "UniversalPlaylistExport_syncbizPlaylistId_fkey" FOREIGN KEY ("syncbizPlaylistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
