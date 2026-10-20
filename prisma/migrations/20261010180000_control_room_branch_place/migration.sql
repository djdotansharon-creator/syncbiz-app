-- Control Room branch location via Google Places (owner-approved 2026-10-10): additive only.
-- Branch: googlePlaceId, formattedAddress (nullable). Existing city / latitude / longitude unchanged.

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "formattedAddress" TEXT,
ADD COLUMN     "googlePlaceId" TEXT;

