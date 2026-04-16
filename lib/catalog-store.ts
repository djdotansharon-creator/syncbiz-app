/**
 * CatalogItem storage — backed by PostgreSQL via Prisma.
 * CatalogItem is GLOBAL (no workspaceId / tenantId).
 * Replaces the previous file-per-item JSON implementation.
 */

import { prisma } from "./prisma";
import type { PlaylistType } from "./playlist-types";
import { canonicalYouTubeWatchUrlForPlayback } from "./playlist-utils";
import { inferGenre } from "./infer-genre";

export function normalizeCatalogUrlKey(url: string, type: PlaylistType): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (type === "youtube") return canonicalYouTubeWatchUrlForPlayback(u).trim();
  return u;
}

/** Derive a genres array from a title. Returns [] if genre is "Mixed" (unrecognised). */
function genresFromTitle(title: string): string[] {
  const g = inferGenre(title);
  return g !== "Mixed" ? [g] : [];
}

/**
 * Find or create a catalog item by its normalized URL.
 * tenantId is accepted for API compatibility but ignored — catalog is global.
 * Automatically populates genres from the title on every create/update.
 */
export async function findOrCreateCatalogItem(input: {
  tenantId: string;   // kept for drop-in compat; not stored
  urlKey: string;
  type: PlaylistType; // kept for drop-in compat; not stored (URL is globally unique)
  title: string;
  thumbnailUrl: string;
}): Promise<{ id: string }> {
  const url = input.urlKey.trim();
  if (!url) throw new Error("urlKey is required");

  const title = (input.title ?? "").trim() || "Untitled";
  const thumbnail = (input.thumbnailUrl ?? "").trim() || null;
  const genres = genresFromTitle(title);

  const row = await prisma.catalogItem.upsert({
    where: { url },
    create: { url, title, thumbnail, genres },
    update: {
      ...(title !== "Untitled" ? { title } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    },
    select: { id: true, genres: true },
  });

  // Backfill genres on existing rows that have none yet (NULL or [])
  if ((row.genres ?? []).length === 0 && genres.length > 0) {
    await prisma.catalogItem.update({
      where: { id: row.id },
      data: { genres },
    });
  }

  return { id: row.id };
}

/**
 * Populate genres for every CatalogItem whose genres array is currently empty.
 * Safe to call multiple times — skips items that already have genres.
 * Returns the number of items updated.
 */
export async function backfillCatalogGenres(): Promise<number> {
  // Fetch all items — NULL arrays are returned as [] by Prisma so we can
  // filter in JS. Using isEmpty:true in WHERE misses NULL-stored arrays.
  const items = await prisma.catalogItem.findMany({
    select: { id: true, title: true, genres: true },
  });

  let updated = 0;
  for (const item of items) {
    if ((item.genres ?? []).length === 0) {
      const genres = genresFromTitle(item.title);
      if (genres.length > 0) {
        await prisma.catalogItem.update({ where: { id: item.id }, data: { genres } });
        updated++;
      }
    }
  }
  return updated;
}
