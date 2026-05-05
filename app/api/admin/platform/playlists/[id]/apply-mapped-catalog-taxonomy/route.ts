import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { getPlaylist } from "@/lib/playlist-store";
import { prisma } from "@/lib/prisma";
import { addCatalogItemTaxonomyTag } from "@/lib/catalog-item-taxonomy-admin";
import { effectivePlaylistUseCases } from "@/lib/playlist-types";
import { collectAllowlistedPlaylistTaxonomyMappings } from "@/lib/playlist-metadata-catalog-taxonomy-map";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

type AppliedRow = Readonly<{
  catalogItemId: string;
  taxonomyTagId: string;
  taxonomySlug: string;
}>;

type DuplicateRow = Readonly<{ catalogItemId: string; taxonomySlug: string }>;

type MissingCatalogRow = Readonly<{ playlistItemId: string; trackId: string; position: number }>;

/**
 * POST — SUPER_ADMIN only. Applies explicit allowlisted playlist metadata → `CatalogItemTaxonomyTag`
 * for playlist items whose `PlaylistItem.catalogId` is already set (no linking side-effects).
 */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: playlistId } = await ctx.params;

  const playlist = await getPlaylist(playlistId);
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  const playlistItems = await prisma.playlistItem.findMany({
    where: { playlistId },
    orderBy: { position: "asc" },
    select: { id: true, catalogId: true, trackId: true, position: true },
  });

  const { mappedValues: mappedValuesRaw, skipped } = collectAllowlistedPlaylistTaxonomyMappings({
    useCasesEffective: effectivePlaylistUseCases(playlist),
    primaryGenre: playlist.primaryGenre,
    subGenres: playlist.subGenres ?? [],
    mood: playlist.mood,
    energyLevel: playlist.energyLevel,
  });

  const targetSlugs = [...new Set(mappedValuesRaw.map((m) => m.taxonomySlug))];
  const taxonomyRows =
    targetSlugs.length === 0
      ? []
      : await prisma.musicTaxonomyTag.findMany({
          where: { slug: { in: targetSlugs }, status: "ACTIVE" },
          select: { id: true, slug: true },
        });

  const slugToId = new Map(taxonomyRows.map((t) => [t.slug, t.id] as const));
  const foundSlugs = new Set(taxonomyRows.map((t) => t.slug));
  const missingTaxonomyTags = targetSlugs.filter((s) => !foundSlugs.has(s));

  const mappedValuesApplicable = mappedValuesRaw.filter((m) => foundSlugs.has(m.taxonomySlug));

  const slugToResolvedId = new Map<string, string>();
  for (const m of mappedValuesApplicable) {
    const tid = slugToId.get(m.taxonomySlug);
    if (tid) slugToResolvedId.set(m.taxonomySlug, tid);
  }
  const taxonomyTargets = [...slugToResolvedId.entries()].map(([taxonomySlug, taxonomyTagId]) => ({
    taxonomySlug,
    taxonomyTagId,
  }));
  const missingCatalogIds: MissingCatalogRow[] = [];
  const linkedCatalogIds: string[] = [];
  for (const row of playlistItems) {
    const cid = row.catalogId?.trim();
    if (!cid) {
      const tid = row.trackId?.trim();
      missingCatalogIds.push({
        playlistItemId: row.id,
        trackId: tid || row.id,
        position: row.position,
      });
    } else linkedCatalogIds.push(cid);
  }
  const uniqueCatalogIds = [...new Set(linkedCatalogIds)];

  const applied: AppliedRow[] = [];
  const duplicates: DuplicateRow[] = [];

  if (taxonomyTargets.length === 0 || uniqueCatalogIds.length === 0) {
    return NextResponse.json({
      playlistId,
      mappedValues: mappedValuesRaw,
      applied,
      skipped,
      duplicates,
      missingCatalogIds,
      missingTaxonomyTags,
    });
  }

  const taxonomyIds = taxonomyTargets.map((t) => t.taxonomyTagId);
  const preExisting = await prisma.catalogItemTaxonomyTag.findMany({
    where: {
      catalogItemId: { in: uniqueCatalogIds },
      taxonomyTagId: { in: taxonomyIds },
    },
    select: { catalogItemId: true, taxonomyTagId: true },
  });
  const preExistingSet = new Set(preExisting.map((r) => `${r.catalogItemId}\t${r.taxonomyTagId}`));

  for (const catalogItemId of uniqueCatalogIds) {
    for (const { taxonomyTagId, taxonomySlug } of taxonomyTargets) {
      const pairKey = `${catalogItemId}\t${taxonomyTagId}`;
      if (preExistingSet.has(pairKey)) {
        duplicates.push({ catalogItemId, taxonomySlug });
        continue;
      }
      await addCatalogItemTaxonomyTag(catalogItemId, taxonomyTagId, admin.id);
      preExistingSet.add(pairKey);
      applied.push({ catalogItemId, taxonomyTagId, taxonomySlug });
    }
  }

  return NextResponse.json({
    playlistId,
    mappedValues: mappedValuesRaw,
    applied,
    skipped,
    duplicates,
    missingCatalogIds,
    missingTaxonomyTags,
  });
}
