-- 2026-11-11 (owner, Music Bank Phase 2 stage D): the per-bank OFFLINE switch in the catalog. Additive only, default off.
-- IF NOT EXISTS: safe to apply to PROD before the code deploy (and re-run by `prisma migrate deploy` afterwards).

-- AlterTable
ALTER TABLE "MusicBankGrant" ADD COLUMN IF NOT EXISTS "offlineEnabled" BOOLEAN NOT NULL DEFAULT false;
