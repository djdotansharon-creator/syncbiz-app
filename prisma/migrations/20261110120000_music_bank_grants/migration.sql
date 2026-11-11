-- Private music banks opened per business by the platform owner (owner 2026-11-10). Additive: one new table, nothing else changes.
CREATE TABLE "MusicBankGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "grantedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicBankGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MusicBankGrant_workspaceId_bankId_key" ON "MusicBankGrant"("workspaceId", "bankId");
CREATE INDEX "MusicBankGrant_bankId_idx" ON "MusicBankGrant"("bankId");

ALTER TABLE "MusicBankGrant" ADD CONSTRAINT "MusicBankGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
