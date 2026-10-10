-- Control Room branch management (owner-approved 2026-10-10): additive only.
-- Branch: street / houseNumber (NOT NULL DEFAULT '') + latitude / longitude / geocodedAt (nullable).
-- Workspace: stationIdPrefix (nullable, globally unique). New table BranchActivationCode (hash only).

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "stationIdPrefix" TEXT;

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "geocodedAt" TIMESTAMP(3),
ADD COLUMN     "houseNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "street" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "BranchActivationCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByDurableDeviceId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BranchActivationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchActivationCode_workspaceId_branchId_idx" ON "BranchActivationCode"("workspaceId", "branchId");

-- CreateIndex
CREATE INDEX "BranchActivationCode_branchId_expiresAt_idx" ON "BranchActivationCode"("branchId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stationIdPrefix_key" ON "Workspace"("stationIdPrefix");

-- AddForeignKey
ALTER TABLE "BranchActivationCode" ADD CONSTRAINT "BranchActivationCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchActivationCode" ADD CONSTRAINT "BranchActivationCode_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

