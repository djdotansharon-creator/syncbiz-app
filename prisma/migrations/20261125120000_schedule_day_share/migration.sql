-- CreateTable
CREATE TABLE "ScheduleDayShare" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "targetBranchId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL DEFAULT 'BRANCH',
    "fromUserId" TEXT NOT NULL,
    "sourceWeekday" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "ledger" JSONB,
    "appliedMode" TEXT,
    "appliedWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "appliedDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleDayShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleDayShare_requestId_key" ON "ScheduleDayShare"("requestId");

-- CreateIndex
CREATE INDEX "ScheduleDayShare_targetBranchId_status_idx" ON "ScheduleDayShare"("targetBranchId", "status");

-- CreateIndex
CREATE INDEX "ScheduleDayShare_workspaceId_idx" ON "ScheduleDayShare"("workspaceId");

-- CreateIndex
CREATE INDEX "ScheduleDayShare_fromUserId_idx" ON "ScheduleDayShare"("fromUserId");

-- AddForeignKey
ALTER TABLE "ScheduleDayShare" ADD CONSTRAINT "ScheduleDayShare_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDayShare" ADD CONSTRAINT "ScheduleDayShare_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
