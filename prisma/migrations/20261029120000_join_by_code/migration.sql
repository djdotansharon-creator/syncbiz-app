-- Join a business by a one-time code: two NEW tables, no change to any existing table (a deploy does not run migrations, so code that knows these tables can reach an environment first without breaking anything).

-- CreateTable
CREATE TABLE "WorkspaceJoinCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceJoinCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceJoinRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "passwordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedRole" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceJoinCode_codeHash_key" ON "WorkspaceJoinCode"("codeHash");

-- CreateIndex
CREATE INDEX "WorkspaceJoinCode_workspaceId_createdAt_idx" ON "WorkspaceJoinCode"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceJoinRequest_workspaceId_status_idx" ON "WorkspaceJoinRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceJoinRequest_email_idx" ON "WorkspaceJoinRequest"("email");

-- AddForeignKey
ALTER TABLE "WorkspaceJoinCode" ADD CONSTRAINT "WorkspaceJoinCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceJoinRequest" ADD CONSTRAINT "WorkspaceJoinRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
