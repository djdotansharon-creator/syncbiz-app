-- Phase B0.5 — Chart ingestion safety + staging readiness.
-- ADDITIVE ONLY. Extends ChartSnapshot with edition/idempotency fields and adds the
-- raw-first ChartObservationEntry + MusicIngestionRun audit tables. It runs AFTER the
-- (also-unapplied) universal_music_identity migration that creates ChartSnapshot, so the
-- ALTERs target a freshly-created, empty table. No existing table is dropped or backfilled.

-- CreateEnum
CREATE TYPE "IngestionRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- AlterTable: ChartSnapshot edition + idempotency + provenance fields (empty table → safe)
ALTER TABLE "ChartSnapshot" ADD COLUMN "editionKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ChartSnapshot" ADD COLUMN "editionUid" TEXT NOT NULL;
ALTER TABLE "ChartSnapshot" ADD COLUMN "chartDate" TIMESTAMP(3);
ALTER TABLE "ChartSnapshot" ADD COLUMN "periodStart" TIMESTAMP(3);
ALTER TABLE "ChartSnapshot" ADD COLUMN "periodEnd" TIMESTAMP(3);
ALTER TABLE "ChartSnapshot" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "ChartSnapshot" ADD COLUMN "sourcePayloadHash" TEXT;
ALTER TABLE "ChartSnapshot" ADD COLUMN "providerVersion" TEXT;
ALTER TABLE "ChartSnapshot" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex: idempotency key (re-ingesting the same edition upserts one snapshot)
CREATE UNIQUE INDEX "ChartSnapshot_editionUid_key" ON "ChartSnapshot"("editionUid");

-- CreateIndex
CREATE INDEX "ChartSnapshot_editionKey_idx" ON "ChartSnapshot"("editionKey");

-- CreateTable
CREATE TABLE "ChartObservationEntry" (
    "id" TEXT NOT NULL,
    "chartSnapshotId" TEXT NOT NULL,
    "externalTrackObservationId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "previousRank" INTEGER,
    "peakRank" INTEGER,
    "daysOnChart" INTEGER,
    "weeksOnChart" INTEGER,
    "movement" TEXT,
    "sourceExternalId" TEXT,
    "rawEntryMetadata" JSONB,
    "matchStatus" "ExternalMatchStatus" NOT NULL DEFAULT 'PENDING',
    "matchedUniversalTrackId" TEXT,
    "promotedChartEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartObservationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicIngestionRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ingestionType" TEXT NOT NULL,
    "sourceReference" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "IngestionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "ambiguousCount" INTEGER NOT NULL DEFAULT 0,
    "unresolvedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "createdSnapshotCount" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "sourcePayloadHash" TEXT,
    "errorSummary" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicIngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChartObservationEntry_chartSnapshotId_idx" ON "ChartObservationEntry"("chartSnapshotId");

-- CreateIndex
CREATE INDEX "ChartObservationEntry_externalTrackObservationId_idx" ON "ChartObservationEntry"("externalTrackObservationId");

-- CreateIndex
CREATE INDEX "ChartObservationEntry_matchStatus_idx" ON "ChartObservationEntry"("matchStatus");

-- CreateIndex
CREATE INDEX "ChartObservationEntry_matchedUniversalTrackId_idx" ON "ChartObservationEntry"("matchedUniversalTrackId");

-- CreateIndex
CREATE INDEX "ChartObservationEntry_chartSnapshotId_rank_idx" ON "ChartObservationEntry"("chartSnapshotId", "rank");

-- CreateIndex
CREATE INDEX "MusicIngestionRun_provider_idx" ON "MusicIngestionRun"("provider");

-- CreateIndex
CREATE INDEX "MusicIngestionRun_status_idx" ON "MusicIngestionRun"("status");

-- CreateIndex
CREATE INDEX "MusicIngestionRun_sourcePayloadHash_idx" ON "MusicIngestionRun"("sourcePayloadHash");

-- CreateIndex
CREATE INDEX "MusicIngestionRun_startedAt_idx" ON "MusicIngestionRun"("startedAt");

-- AddForeignKey
ALTER TABLE "ChartObservationEntry" ADD CONSTRAINT "ChartObservationEntry_chartSnapshotId_fkey" FOREIGN KEY ("chartSnapshotId") REFERENCES "ChartSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartObservationEntry" ADD CONSTRAINT "ChartObservationEntry_externalTrackObservationId_fkey" FOREIGN KEY ("externalTrackObservationId") REFERENCES "ExternalTrackObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartObservationEntry" ADD CONSTRAINT "ChartObservationEntry_matchedUniversalTrackId_fkey" FOREIGN KEY ("matchedUniversalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartObservationEntry" ADD CONSTRAINT "ChartObservationEntry_promotedChartEntryId_fkey" FOREIGN KEY ("promotedChartEntryId") REFERENCES "ChartEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
