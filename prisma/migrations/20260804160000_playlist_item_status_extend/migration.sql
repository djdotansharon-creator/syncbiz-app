-- MVP hardening — add PROVIDER_RESOLVED + REMOVED_FROM_SOURCE to the item-status enum.
-- ADDITIVE: only new enum values. Existing rows/values are untouched.

ALTER TYPE "UniversalPlaylistItemStatus" ADD VALUE IF NOT EXISTS 'PROVIDER_RESOLVED';
ALTER TYPE "UniversalPlaylistItemStatus" ADD VALUE IF NOT EXISTS 'REMOVED_FROM_SOURCE';
