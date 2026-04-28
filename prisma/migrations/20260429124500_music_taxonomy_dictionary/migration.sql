-- CreateEnum
CREATE TYPE "MusicTaxonomyCategory" AS ENUM ('PLAYBACK_CONTEXT', 'VIBE_ENERGY', 'MAIN_SOUND_GENRE', 'STYLE_TAGS', 'ISRAELI_SPECIALS', 'TECHNICAL_TAGS', 'BUSINESS_FIT', 'DAYPART_FIT');

-- CreateEnum
CREATE TYPE "MusicTaxonomyTagStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'HIDDEN', 'MERGED');

-- CreateTable
CREATE TABLE "MusicTaxonomyTag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "MusicTaxonomyCategory" NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelHe" TEXT NOT NULL,
    "descriptionHeUser" TEXT,
    "descriptionAi" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "MusicTaxonomyTagStatus" NOT NULL DEFAULT 'ACTIVE',
    "parentId" TEXT,
    "mergedIntoId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicTaxonomyTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MusicTaxonomyTag_slug_key" ON "MusicTaxonomyTag"("slug");

-- CreateIndex
CREATE INDEX "MusicTaxonomyTag_category_idx" ON "MusicTaxonomyTag"("category");

-- CreateIndex
CREATE INDEX "MusicTaxonomyTag_status_idx" ON "MusicTaxonomyTag"("status");

-- CreateIndex
CREATE INDEX "MusicTaxonomyTag_parentId_idx" ON "MusicTaxonomyTag"("parentId");

-- CreateIndex
CREATE INDEX "MusicTaxonomyTag_mergedIntoId_idx" ON "MusicTaxonomyTag"("mergedIntoId");

-- AddForeignKey
ALTER TABLE "MusicTaxonomyTag" ADD CONSTRAINT "MusicTaxonomyTag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MusicTaxonomyTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicTaxonomyTag" ADD CONSTRAINT "MusicTaxonomyTag_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "MusicTaxonomyTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
