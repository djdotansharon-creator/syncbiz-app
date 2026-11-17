-- A schedule block can carry the player's volume (0-100) for its time (owner 2026-11-17). Additive and nullable: every existing block keeps NULL = "leave the volume as it is".
ALTER TABLE "Schedule" ADD COLUMN "volume" INTEGER;
