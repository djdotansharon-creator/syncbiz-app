-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PREMIUM', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'WORKSPACE_ADMIN', 'MANAGER', 'CONTROLLER', 'VIEWER');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('ELECTRON', 'BROWSER', 'MPV');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiDjStatus" AS ENUM ('IN_PROGRESS', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GuestPermission" AS ENUM ('VIEW_ONLY', 'ADD_URL', 'VOTE', 'REQUEST_SONG');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('RESTAURANT', 'GYM', 'HOTEL', 'BAR', 'CAFE', 'RETAIL', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "AddonType" AS ENUM ('AI_ANNOUNCEMENTS', 'MULTI_ZONE', 'VIDEO_SCREENS', 'EXTRA_USERS');

-- CreateEnum
CREATE TYPE "TimeSlot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'NIGHT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CONTROLLER',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CONTROLLER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "businessType" "BusinessType" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeviceType" NOT NULL DEFAULT 'ELECTRON',
    "token" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "sharedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistItem" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "sourceId" TEXT,
    "catalogId" TEXT,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronExpr" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "durationSec" INTEGER,
    "thumbnail" TEXT,
    "genres" TEXT[],
    "businessTypes" "BusinessType"[],
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogAnalytics" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "sharedCount" INTEGER NOT NULL DEFAULT 0,
    "aiDjCount" INTEGER NOT NULL DEFAULT 0,
    "trendingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogPlayByBusiness" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogPlayByBusiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceBilling" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "expiresAt" TIMESTAMP(3),
    "maxUrls" INTEGER NOT NULL DEFAULT 10,
    "maxBranches" INTEGER NOT NULL DEFAULT 1,
    "maxDevices" INTEGER NOT NULL DEFAULT 1,
    "maxControllers" INTEGER NOT NULL DEFAULT 2,
    "maxPlaylists" INTEGER NOT NULL DEFAULT 5,
    "schedulingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceAddon" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "addon" "AddonType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceAddon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "permissions" "GuestPermission"[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "voiceId" TEXT,
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "defaultVolume" INTEGER NOT NULL DEFAULT 80,
    "musicDuckLevel" INTEGER NOT NULL DEFAULT 17,
    "jingleVolume" INTEGER NOT NULL DEFAULT 90,
    "fadeDurationMs" INTEGER NOT NULL DEFAULT 500,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnouncementChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDjSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "hours" JSONB NOT NULL,
    "style" TEXT[],
    "demographics" JSONB,
    "messages" JSONB NOT NULL,
    "status" "AiDjStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDjSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDjPlaylist" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "playlistId" TEXT,
    "slot" "TimeSlot" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDjPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Branch_workspaceId_idx" ON "Branch"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_token_key" ON "Device"("token");

-- CreateIndex
CREATE INDEX "Device_workspaceId_idx" ON "Device"("workspaceId");

-- CreateIndex
CREATE INDEX "Device_branchId_idx" ON "Device"("branchId");

-- CreateIndex
CREATE INDEX "Device_token_idx" ON "Device"("token");

-- CreateIndex
CREATE INDEX "Source_workspaceId_idx" ON "Source"("workspaceId");

-- CreateIndex
CREATE INDEX "Playlist_workspaceId_idx" ON "Playlist"("workspaceId");

-- CreateIndex
CREATE INDEX "Playlist_isShared_idx" ON "Playlist"("isShared");

-- CreateIndex
CREATE INDEX "PlaylistItem_playlistId_idx" ON "PlaylistItem"("playlistId");

-- CreateIndex
CREATE INDEX "PlaylistItem_sourceId_idx" ON "PlaylistItem"("sourceId");

-- CreateIndex
CREATE INDEX "PlaylistItem_catalogId_idx" ON "PlaylistItem"("catalogId");

-- CreateIndex
CREATE INDEX "Schedule_workspaceId_idx" ON "Schedule"("workspaceId");

-- CreateIndex
CREATE INDEX "Schedule_branchId_idx" ON "Schedule"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_url_key" ON "CatalogItem"("url");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogAnalytics_catalogItemId_key" ON "CatalogAnalytics"("catalogItemId");

-- CreateIndex
CREATE INDEX "CatalogAnalytics_trendingScore_idx" ON "CatalogAnalytics"("trendingScore");

-- CreateIndex
CREATE INDEX "CatalogAnalytics_playCount_idx" ON "CatalogAnalytics"("playCount");

-- CreateIndex
CREATE INDEX "CatalogPlayByBusiness_catalogItemId_idx" ON "CatalogPlayByBusiness"("catalogItemId");

-- CreateIndex
CREATE INDEX "CatalogPlayByBusiness_businessType_idx" ON "CatalogPlayByBusiness"("businessType");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogPlayByBusiness_catalogItemId_businessType_key" ON "CatalogPlayByBusiness"("catalogItemId", "businessType");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceBilling_workspaceId_key" ON "WorkspaceBilling"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceAddon_workspaceId_idx" ON "WorkspaceAddon"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAddon_workspaceId_addon_key" ON "WorkspaceAddon"("workspaceId", "addon");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_idx" ON "AuditLog"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_token_key" ON "GuestSession"("token");

-- CreateIndex
CREATE INDEX "GuestSession_workspaceId_idx" ON "GuestSession"("workspaceId");

-- CreateIndex
CREATE INDEX "GuestSession_token_idx" ON "GuestSession"("token");

-- CreateIndex
CREATE INDEX "GuestSession_expiresAt_idx" ON "GuestSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Announcement_workspaceId_idx" ON "Announcement"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementChannel_workspaceId_key" ON "AnnouncementChannel"("workspaceId");

-- CreateIndex
CREATE INDEX "AiDjSession_workspaceId_idx" ON "AiDjSession"("workspaceId");

-- CreateIndex
CREATE INDEX "AiDjSession_userId_idx" ON "AiDjSession"("userId");

-- CreateIndex
CREATE INDEX "AiDjSession_createdAt_idx" ON "AiDjSession"("createdAt");

-- CreateIndex
CREATE INDEX "AiDjPlaylist_sessionId_idx" ON "AiDjPlaylist"("sessionId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogAnalytics" ADD CONSTRAINT "CatalogAnalytics_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPlayByBusiness" ADD CONSTRAINT "CatalogPlayByBusiness_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceBilling" ADD CONSTRAINT "WorkspaceBilling_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAddon" ADD CONSTRAINT "WorkspaceAddon_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementChannel" ADD CONSTRAINT "AnnouncementChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDjSession" ADD CONSTRAINT "AiDjSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDjSession" ADD CONSTRAINT "AiDjSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDjPlaylist" ADD CONSTRAINT "AiDjPlaylist_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiDjSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDjPlaylist" ADD CONSTRAINT "AiDjPlaylist_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
