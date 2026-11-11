-- 2026-11-11 (owner): a private-bank close takes effect at the next 04:00 (branch time), never mid-day; stations then
-- switch to the business's fallback music. Additive only: three nullable columns, no data change, no index change.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "fallbackPlaylistId" TEXT;

-- AlterTable
ALTER TABLE "MusicBankGrant" ADD COLUMN "closesAt" TIMESTAMP(3),
ADD COLUMN "closeReason" TEXT;
