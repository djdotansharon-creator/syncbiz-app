-- 2026-11-11 (owner): a private-bank close takes effect at the next 04:00 (branch time), never mid-day; stations then
-- switch to the business's fallback music. Additive only: three nullable columns, no data change, no index change.
-- IF NOT EXISTS: this SQL is applied to PROD BEFORE the code deploy (the new Prisma client selects Workspace.fallbackPlaylistId
-- on every workspace read, so the column must exist first); `prisma migrate deploy` afterwards then just records it.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "fallbackPlaylistId" TEXT;

-- AlterTable
ALTER TABLE "MusicBankGrant" ADD COLUMN IF NOT EXISTS "closesAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "closeReason" TEXT;
