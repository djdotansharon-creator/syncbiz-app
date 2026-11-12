-- 2026-11-12 (owner): Offline is chosen per COMPUTER and per bank ("only the bank I click downloads, each computer on its
-- own"). New table only — nothing existing changes. IF NOT EXISTS: safe to apply to PROD before the code deploy (and
-- re-run by `prisma migrate deploy` afterwards). The one-time copy of today's per-business choices to each station is a
-- separate idempotent command (scripts/sql/station-offline-backfill.sql), run once before the deploy.

-- CreateTable
CREATE TABLE IF NOT EXISTS "StationOfflineBank" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "durableDeviceId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationOfflineBank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StationOfflineBank_durableDeviceId_bankId_key" ON "StationOfflineBank"("durableDeviceId", "bankId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StationOfflineBank_workspaceId_idx" ON "StationOfflineBank"("workspaceId");
