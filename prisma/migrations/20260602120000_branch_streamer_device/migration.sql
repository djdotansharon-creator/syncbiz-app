-- CreateTable
CREATE TABLE "BranchStreamerDevice" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'default',
    "devicePurpose" TEXT NOT NULL DEFAULT 'branch_streamer_station',
    "branchUserId" TEXT NOT NULL,
    "pairedByUserId" TEXT,
    "label" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchStreamerDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamerPairingCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "branchId" TEXT,
    "branchUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "tokenDeliveredAt" TIMESTAMP(3),
    "pendingToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamerPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchStreamerDevice_deviceId_key" ON "BranchStreamerDevice"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchStreamerDevice_tokenHash_key" ON "BranchStreamerDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "BranchStreamerDevice_workspaceId_branchId_idx" ON "BranchStreamerDevice"("workspaceId", "branchId");

-- CreateIndex
CREATE INDEX "BranchStreamerDevice_branchUserId_idx" ON "BranchStreamerDevice"("branchUserId");

-- CreateIndex
CREATE INDEX "BranchStreamerDevice_revokedAt_idx" ON "BranchStreamerDevice"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StreamerPairingCode_code_key" ON "StreamerPairingCode"("code");

-- CreateIndex
CREATE INDEX "StreamerPairingCode_deviceId_idx" ON "StreamerPairingCode"("deviceId");

-- CreateIndex
CREATE INDEX "StreamerPairingCode_expiresAt_idx" ON "StreamerPairingCode"("expiresAt");
