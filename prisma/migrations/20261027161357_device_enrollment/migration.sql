-- Device enrollment: two NEW tables, no change to any existing table (a deploy does not run migrations, so code that knows these tables can reach an environment first without breaking anything).

-- CreateTable
CREATE TABLE "WorkspaceEnrollmentSetting" (
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ttlDays" INTEGER NOT NULL DEFAULT 7,
    "maxPlayers" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceEnrollmentSetting_pkey" PRIMARY KEY ("workspaceId")
);

-- AddForeignKey
ALTER TABLE "WorkspaceEnrollmentSetting" ADD CONSTRAINT "WorkspaceEnrollmentSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "DeviceEnrollment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "durableDeviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "platform" TEXT NOT NULL DEFAULT 'browser',
    "requestedRole" TEXT NOT NULL,
    "approvedRole" TEXT,
    "playerClass" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "appVersion" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "requestIp" TEXT NOT NULL DEFAULT '',
    "requestedByUserId" TEXT NOT NULL,
    "requestedBranchId" TEXT,
    "approvedBranchIds" TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "grandfathered" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceEnrollment_workspaceId_status_idx" ON "DeviceEnrollment"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "DeviceEnrollment_workspaceId_approvedRole_idx" ON "DeviceEnrollment"("workspaceId", "approvedRole");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceEnrollment_workspaceId_durableDeviceId_key" ON "DeviceEnrollment"("workspaceId", "durableDeviceId");

-- AddForeignKey
ALTER TABLE "DeviceEnrollment" ADD CONSTRAINT "DeviceEnrollment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
