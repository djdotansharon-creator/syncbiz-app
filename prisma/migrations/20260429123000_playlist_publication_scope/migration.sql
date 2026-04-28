-- CreateEnum
CREATE TYPE "PlaylistPublicationScope" AS ENUM ('PRIVATE', 'LINK_SHARED', 'COMMUNITY_PUBLISHED', 'TEMPLATE', 'OFFICIAL_SYNCBIZ', 'FORK_REMIX');

-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN "publicationScope" "PlaylistPublicationScope" NOT NULL DEFAULT 'PRIVATE';

-- CreateIndex
CREATE INDEX "Playlist_publicationScope_idx" ON "Playlist"("publicationScope");
