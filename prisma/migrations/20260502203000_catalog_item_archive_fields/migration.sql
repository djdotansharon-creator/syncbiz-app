-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedByUserId" TEXT,
ADD COLUMN "archiveReason" TEXT;

-- CreateIndex
CREATE INDEX "CatalogItem_archivedAt_idx" ON "CatalogItem"("archivedAt");

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
