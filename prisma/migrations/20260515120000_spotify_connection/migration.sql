-- CreateTable
CREATE TABLE "SpotifyConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spotifyUserId" TEXT NOT NULL,
    "spotifyDisplayName" TEXT,
    "encryptedTokenBlob" BYTEA NOT NULL,
    "tokenIv" BYTEA NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpotifyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpotifyConnection_userId_key" ON "SpotifyConnection"("userId");

-- CreateIndex
CREATE INDEX "SpotifyConnection_expiresAt_idx" ON "SpotifyConnection"("expiresAt");

-- AddForeignKey
ALTER TABLE "SpotifyConnection" ADD CONSTRAINT "SpotifyConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
