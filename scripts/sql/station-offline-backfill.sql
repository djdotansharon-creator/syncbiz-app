-- 2026-11-12 (owner): one-time copy of the per-BUSINESS Offline choice (MusicBankGrant.offlineEnabled, stage D) to every
-- registered computer of that business, so no station deletes songs it already downloaded when Offline becomes per
-- COMPUTER (StationOfflineBank). Idempotent: ON CONFLICT DO NOTHING — re-running adds nothing new for a computer that
-- already has the row. Run once, before the per-computer code deploys, right after the table exists.
INSERT INTO "StationOfflineBank" ("id", "workspaceId", "durableDeviceId", "bankId", "createdByUserId", "createdAt")
SELECT gen_random_uuid()::text, g."workspaceId", s."durableDeviceId", g."bankId", NULL, CURRENT_TIMESTAMP
FROM "MusicBankGrant" g
JOIN "StationDevice" s ON s."workspaceId" = g."workspaceId"
WHERE g."offlineEnabled" = true
ON CONFLICT ("durableDeviceId", "bankId") DO NOTHING;
