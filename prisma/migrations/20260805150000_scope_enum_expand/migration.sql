-- Expand EnrichmentScope to the owner's canonical set. Additive + data-preserving.
-- CLIENT (generic) is renamed to CLIENT_SPECIFIC; EVENT_SPECIFIC + INTERNAL are added.
-- Default stays REVIEW. Existing rows (the 50-song slice) are migrated in place.
ALTER TABLE "TrackEnrichment" ALTER COLUMN "scope" DROP DEFAULT;
ALTER TABLE "TrackEnrichment" ALTER COLUMN "scope" TYPE text USING ("scope"::text);
UPDATE "TrackEnrichment" SET "scope" = 'CLIENT_SPECIFIC' WHERE "scope" = 'CLIENT';
DROP TYPE "EnrichmentScope";
CREATE TYPE "EnrichmentScope" AS ENUM ('GENERAL', 'CLIENT_SPECIFIC', 'EVENT_SPECIFIC', 'INTERNAL', 'REVIEW', 'IGNORE');
ALTER TABLE "TrackEnrichment" ALTER COLUMN "scope" TYPE "EnrichmentScope" USING ("scope"::"EnrichmentScope");
ALTER TABLE "TrackEnrichment" ALTER COLUMN "scope" SET DEFAULT 'REVIEW';
