-- CreateEnum
CREATE TYPE "SourceAuthType" AS ENUM ('OAUTH2', 'API_KEY', 'DEVICE_LOCAL', 'NONE');

-- CreateEnum
CREATE TYPE "SourceConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SourceContainerType" AS ENUM ('FOLDER', 'PLAYLIST', 'ALBUM', 'DEVICE_LIBRARY', 'ROOT');

-- CreateEnum
CREATE TYPE "SourceContainerStatus" AS ENUM ('ACTIVE', 'GONE', 'ERROR');

-- CreateEnum
CREATE TYPE "LocatorAddressKind" AS ENUM ('SIGNED_URL', 'PUBLIC_URL', 'LOCAL_PATH_REF', 'RESOLVE_TARGET');

-- CreateEnum
CREATE TYPE "LocatorStatus" AS ENUM ('RESOLVED', 'UNRESOLVED', 'AMBIGUOUS', 'MISSING', 'MOVED', 'REMOVED');

-- CreateTable
CREATE TABLE "SourceConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "authType" "SourceAuthType" NOT NULL DEFAULT 'OAUTH2',
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "externalAccountId" TEXT,
    "accountLabel" TEXT,
    "deviceId" TEXT,
    "encryptedTokenBlob" BYTEA,
    "tokenIv" BYTEA,
    "scope" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "status" "SourceConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceContainer" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "containerType" "SourceContainerType" NOT NULL,
    "externalContainerId" TEXT NOT NULL,
    "parentContainerId" TEXT,
    "name" TEXT NOT NULL,
    "displayPath" TEXT,
    "syncCursor" TEXT,
    "lastListedAt" TIMESTAMP(3),
    "status" "SourceContainerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceContainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceLocator" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "containerId" TEXT,
    "universalTrackId" TEXT,
    "provider" TEXT NOT NULL,
    "stableExternalId" TEXT NOT NULL,
    "addressKind" "LocatorAddressKind" NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "contentHash" TEXT,
    "contentHashAlgorithm" TEXT,
    "status" "LocatorStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "lastSeenAt" TIMESTAMP(3),
    "lastResolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceLocator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceConnection_userId_idx" ON "SourceConnection"("userId");

-- CreateIndex
CREATE INDEX "SourceConnection_workspaceId_idx" ON "SourceConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "SourceConnection_provider_idx" ON "SourceConnection"("provider");

-- CreateIndex
CREATE INDEX "SourceConnection_status_idx" ON "SourceConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceConnection_userId_provider_externalAccountId_key" ON "SourceConnection"("userId", "provider", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceConnection_provider_deviceId_key" ON "SourceConnection"("provider", "deviceId");

-- CreateIndex
CREATE INDEX "SourceContainer_connectionId_idx" ON "SourceContainer"("connectionId");

-- CreateIndex
CREATE INDEX "SourceContainer_parentContainerId_idx" ON "SourceContainer"("parentContainerId");

-- CreateIndex
CREATE INDEX "SourceContainer_connectionId_status_idx" ON "SourceContainer"("connectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceContainer_connectionId_externalContainerId_key" ON "SourceContainer"("connectionId", "externalContainerId");

-- CreateIndex
CREATE INDEX "SourceLocator_universalTrackId_idx" ON "SourceLocator"("universalTrackId");

-- CreateIndex
CREATE INDEX "SourceLocator_connectionId_idx" ON "SourceLocator"("connectionId");

-- CreateIndex
CREATE INDEX "SourceLocator_containerId_idx" ON "SourceLocator"("containerId");

-- CreateIndex
CREATE INDEX "SourceLocator_provider_stableExternalId_idx" ON "SourceLocator"("provider", "stableExternalId");

-- CreateIndex
CREATE INDEX "SourceLocator_status_idx" ON "SourceLocator"("status");

-- CreateIndex
CREATE INDEX "SourceLocator_contentHash_idx" ON "SourceLocator"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "SourceLocator_connectionId_stableExternalId_key" ON "SourceLocator"("connectionId", "stableExternalId");

-- AddForeignKey
ALTER TABLE "SourceContainer" ADD CONSTRAINT "SourceContainer_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceContainer" ADD CONSTRAINT "SourceContainer_parentContainerId_fkey" FOREIGN KEY ("parentContainerId") REFERENCES "SourceContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceLocator" ADD CONSTRAINT "SourceLocator_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceLocator" ADD CONSTRAINT "SourceLocator_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "SourceContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceLocator" ADD CONSTRAINT "SourceLocator_universalTrackId_fkey" FOREIGN KEY ("universalTrackId") REFERENCES "UniversalTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

