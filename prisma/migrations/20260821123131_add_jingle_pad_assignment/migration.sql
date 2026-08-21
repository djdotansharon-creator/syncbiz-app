-- CreateTable
CREATE TABLE "JinglePadAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'default',
    "padId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "color" TEXT,
    "bellStyle" TEXT,
    "preRoll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JinglePadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JinglePadAssignment_workspaceId_branchId_idx" ON "JinglePadAssignment"("workspaceId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "JinglePadAssignment_workspaceId_branchId_padId_key" ON "JinglePadAssignment"("workspaceId", "branchId", "padId");
