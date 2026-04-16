-- DropForeignKey
ALTER TABLE "Schedule" DROP CONSTRAINT "Schedule_playlistId_fkey";

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "announcementStatus" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "announcementType" TEXT,
ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "resumePreviousSource" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "ttsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "windowEnd" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "windowStart" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "name" SET DEFAULT '',
ALTER COLUMN "text" SET DEFAULT '',
ALTER COLUMN "audioUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "city" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "code" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "country" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "devicesOnline" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "devicesTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "agentVersion" TEXT NOT NULL DEFAULT '1.0.0',
ADD COLUMN     "capabilities" TEXT[],
ADD COLUMN     "currentSourceId" TEXT,
ADD COLUMN     "deviceKind" TEXT NOT NULL DEFAULT 'audio-player',
ADD COLUMN     "deviceStatus" TEXT NOT NULL DEFAULT 'offline',
ADD COLUMN     "health" TEXT NOT NULL DEFAULT 'ok',
ADD COLUMN     "ipAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastHeartbeat" TEXT,
ADD COLUMN     "platform" TEXT NOT NULL DEFAULT 'windows',
ADD COLUMN     "volume" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "catalogItemId" TEXT,
ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "energyLevel" TEXT,
ADD COLUMN     "genre" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "libraryPlacement" TEXT,
ADD COLUMN     "mood" TEXT,
ADD COLUMN     "playlistOwnershipScope" TEXT,
ADD COLUMN     "playlistType" TEXT NOT NULL DEFAULT 'youtube',
ADD COLUMN     "primaryGenre" TEXT,
ADD COLUMN     "scheduleContributorBlocks" JSONB,
ADD COLUMN     "subGenres" TEXT[],
ADD COLUMN     "thumbnail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "trackOrder" TEXT[],
ADD COLUMN     "url" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "useCase" TEXT,
ADD COLUMN     "useCases" TEXT[],
ADD COLUMN     "viewCount" INTEGER;

-- AlterTable
ALTER TABLE "PlaylistItem" ADD COLUMN     "cover" TEXT,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "trackId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "trackType" TEXT NOT NULL DEFAULT 'youtube',
ADD COLUMN     "url" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "daysOfWeek" INTEGER[],
ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "endTimeLocal" TEXT NOT NULL DEFAULT '23:59',
ADD COLUMN     "oneOffDateLocal" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "recurrence" TEXT NOT NULL DEFAULT 'weekly',
ADD COLUMN     "requestedEndPosition" INTEGER,
ADD COLUMN     "requestedStartPosition" INTEGER,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "startTimeLocal" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "targetId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "targetType" TEXT NOT NULL DEFAULT 'SOURCE',
ADD COLUMN     "taxonomyTags" JSONB,
ADD COLUMN     "updatedBy" TEXT,
ALTER COLUMN "playlistId" DROP NOT NULL,
ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "cronExpr" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "artworkUrl" TEXT,
ADD COLUMN     "branchId" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "browserPreference" TEXT,
ADD COLUMN     "capabilities" TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "fallbackUriOrPath" TEXT,
ADD COLUMN     "isLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "playerMode" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "taxonomyTags" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- CreateTable
CREATE TABLE "UserBranchAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BRANCH_CONTROLLER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBranchAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserBranchAssignment_userId_idx" ON "UserBranchAssignment"("userId");

-- CreateIndex
CREATE INDEX "UserBranchAssignment_workspaceId_idx" ON "UserBranchAssignment"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBranchAssignment_userId_workspaceId_branchId_key" ON "UserBranchAssignment"("userId", "workspaceId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Playlist_branchId_idx" ON "Playlist"("branchId");

-- CreateIndex
CREATE INDEX "Source_branchId_idx" ON "Source"("branchId");

-- AddForeignKey
ALTER TABLE "UserBranchAssignment" ADD CONSTRAINT "UserBranchAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBranchAssignment" ADD CONSTRAINT "UserBranchAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
