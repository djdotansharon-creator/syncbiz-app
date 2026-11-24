-- CreateEnum
CREATE TYPE "PlaylistShareTargetKind" AS ENUM ('BRANCH', 'USER');

-- CreateEnum
CREATE TYPE "PlaylistShareStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "handle" TEXT;

-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "createdByUserId" TEXT;

-- CreateTable
CREATE TABLE "PlaylistShare" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "targetKind" "PlaylistShareTargetKind" NOT NULL,
    "targetBranchId" TEXT,
    "targetUserId" TEXT,
    "status" "PlaylistShareStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PlaylistShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaylistShare_playlistId_idx" ON "PlaylistShare"("playlistId");

-- CreateIndex
CREATE INDEX "PlaylistShare_fromUserId_idx" ON "PlaylistShare"("fromUserId");

-- CreateIndex
CREATE INDEX "PlaylistShare_targetUserId_status_idx" ON "PlaylistShare"("targetUserId", "status");

-- CreateIndex
CREATE INDEX "PlaylistShare_targetBranchId_status_idx" ON "PlaylistShare"("targetBranchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE INDEX "Playlist_createdByUserId_idx" ON "Playlist"("createdByUserId");

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistShare" ADD CONSTRAINT "PlaylistShare_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistShare" ADD CONSTRAINT "PlaylistShare_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistShare" ADD CONSTRAINT "PlaylistShare_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

