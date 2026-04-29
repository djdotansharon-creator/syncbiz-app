-- CreateEnum
CREATE TYPE "CatalogItemTaxonomyTagSource" AS ENUM ('MANUAL');

-- CreateTable
CREATE TABLE "CatalogItemTaxonomyTag" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "taxonomyTagId" TEXT NOT NULL,
    "source" "CatalogItemTaxonomyTagSource" NOT NULL DEFAULT 'MANUAL',
    "confidence" DOUBLE PRECISION,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItemTaxonomyTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemTaxonomyTag_catalogItemId_taxonomyTagId_key" ON "CatalogItemTaxonomyTag"("catalogItemId", "taxonomyTagId");

-- CreateIndex
CREATE INDEX "CatalogItemTaxonomyTag_catalogItemId_idx" ON "CatalogItemTaxonomyTag"("catalogItemId");

-- CreateIndex
CREATE INDEX "CatalogItemTaxonomyTag_taxonomyTagId_idx" ON "CatalogItemTaxonomyTag"("taxonomyTagId");

-- AddForeignKey
ALTER TABLE "CatalogItemTaxonomyTag" ADD CONSTRAINT "CatalogItemTaxonomyTag_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemTaxonomyTag" ADD CONSTRAINT "CatalogItemTaxonomyTag_taxonomyTagId_fkey" FOREIGN KEY ("taxonomyTagId") REFERENCES "MusicTaxonomyTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemTaxonomyTag" ADD CONSTRAINT "CatalogItemTaxonomyTag_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
