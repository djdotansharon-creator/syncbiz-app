-- CreateTable
CREATE TABLE "StationDevice" (
    "id" TEXT NOT NULL,
    "durableDeviceId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "firstRegisteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StationDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StationDevice_durableDeviceId_key" ON "StationDevice"("durableDeviceId");

-- CreateIndex
CREATE INDEX "StationDevice_workspaceId_idx" ON "StationDevice"("workspaceId");

-- CreateIndex
CREATE INDEX "StationDevice_workspaceId_branchId_idx" ON "StationDevice"("workspaceId", "branchId");
