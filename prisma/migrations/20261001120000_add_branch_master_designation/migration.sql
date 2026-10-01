-- CreateTable
CREATE TABLE "BranchMasterDesignation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "durableDeviceId" TEXT NOT NULL,
    "designatedBy" TEXT NOT NULL,
    "designatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchMasterDesignation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchMasterDesignation_workspaceId_branchId_key" ON "BranchMasterDesignation"("workspaceId", "branchId");

-- CreateIndex
CREATE INDEX "BranchMasterDesignation_workspaceId_idx" ON "BranchMasterDesignation"("workspaceId");

-- CreateIndex
CREATE INDEX "BranchMasterDesignation_durableDeviceId_idx" ON "BranchMasterDesignation"("durableDeviceId");
