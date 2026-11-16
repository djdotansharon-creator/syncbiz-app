-- Per-track length (seconds) so a playlist's total length can be known and kept (owner 2026-11-15). Additive + nullable: nothing existing changes.
ALTER TABLE "PlaylistItem" ADD COLUMN "durationSec" INTEGER;
