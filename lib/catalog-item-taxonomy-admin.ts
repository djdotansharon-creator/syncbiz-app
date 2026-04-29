import "server-only";

import type { CatalogItemTaxonomyTag, MusicTaxonomyTag } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CatalogItemTaxonomyLinkDTO = CatalogItemTaxonomyTag & {
  taxonomyTag: Pick<
    MusicTaxonomyTag,
    "id" | "slug" | "category" | "labelEn" | "labelHe" | "status"
  >;
};

/**
 * Lists taxonomy tags linked to a catalog row (SUPER_ADMIN callers only — enforced at route layer).
 */
export async function listCatalogItemTaxonomyLinks(
  catalogItemId: string,
): Promise<CatalogItemTaxonomyLinkDTO[]> {
  return prisma.catalogItemTaxonomyTag.findMany({
    where: { catalogItemId },
    include: {
      taxonomyTag: {
        select: {
          id: true,
          slug: true,
          category: true,
          labelEn: true,
          labelHe: true,
          status: true,
        },
      },
    },
    orderBy: [{ taxonomyTag: { category: "asc" } }, { taxonomyTag: { sortOrder: "asc" } }],
  });
}

async function assertActiveTaxonomyTagIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await prisma.musicTaxonomyTag.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: { id: true },
  });
  if (rows.length !== ids.length) {
    throw new Error("One or more taxonomy tag ids are missing or not ACTIVE");
  }
}

/**
 * Replace the full tag set for a catalog item. Preserves rows unchanged when a tag stays selected.
 */
export async function replaceCatalogItemTaxonomyTags(
  catalogItemId: string,
  taxonomyTagIds: string[],
  createdById: string | null,
): Promise<void> {
  const unique = [...new Set(taxonomyTagIds)];
  await assertActiveTaxonomyTagIds(unique);

  await prisma.$transaction(async (tx) => {
    await tx.catalogItemTaxonomyTag.deleteMany({
      where: {
        catalogItemId,
        taxonomyTagId: { notIn: unique },
      },
    });

    const existing = await tx.catalogItemTaxonomyTag.findMany({
      where: { catalogItemId },
      select: { taxonomyTagId: true },
    });
    const have = new Set(existing.map((r) => r.taxonomyTagId));
    const toAdd = unique.filter((id) => !have.has(id));
    if (toAdd.length === 0) return;

    await tx.catalogItemTaxonomyTag.createMany({
      data: toAdd.map((taxonomyTagId) => ({
        catalogItemId,
        taxonomyTagId,
        source: "MANUAL" as const,
        createdById,
      })),
    });
  });
}

export async function addCatalogItemTaxonomyTag(
  catalogItemId: string,
  taxonomyTagId: string,
  createdById: string | null,
): Promise<void> {
  await assertActiveTaxonomyTagIds([taxonomyTagId]);

  try {
    await prisma.catalogItemTaxonomyTag.create({
      data: {
        catalogItemId,
        taxonomyTagId,
        source: "MANUAL",
        createdById,
      },
    });
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return;
    }
    throw e;
  }
}

export async function removeCatalogItemTaxonomyTag(
  catalogItemId: string,
  taxonomyTagId: string,
): Promise<{ deleted: number }> {
  const result = await prisma.catalogItemTaxonomyTag.deleteMany({
    where: { catalogItemId, taxonomyTagId },
  });
  return { deleted: result.count };
}
