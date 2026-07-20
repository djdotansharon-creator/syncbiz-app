-- CreateTable
CREATE TABLE "PlaybackIncident" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "deviceId" TEXT,
    "branchId" TEXT,
    "workspaceId" TEXT,
    "userEmail" TEXT,
    "deviceMode" TEXT,
    "platform" TEXT,
    "sourceType" TEXT,
    "sourceTitle" TEXT,
    "urlHost" TEXT,
    "attempt" INTEGER,
    "frozenMs" INTEGER,
    "recovered" BOOLEAN,
    "mpvStatus" TEXT,
    "engineReady" BOOLEAN,
    "appVersion" TEXT,
    "detail" JSONB,

    CONSTRAINT "PlaybackIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaybackIncident_createdAt_idx" ON "PlaybackIncident"("createdAt");

-- CreateIndex
CREATE INDEX "PlaybackIncident_branchId_idx" ON "PlaybackIncident"("branchId");

-- CreateIndex
CREATE INDEX "PlaybackIncident_kind_idx" ON "PlaybackIncident"("kind");
