/**
 * CatalogItem storage — backed by PostgreSQL via Prisma.
 * CatalogItem is GLOBAL (no workspaceId / tenantId).
 * Replaces the previous file-per-item JSON implementation.
 */

import { prisma } from "./prisma";
import type { PlaylistType } from "./playlist-types";
import { getYouTubeVideoId } from "./playlist-utils";
import { inferGenre } from "./infer-genre";

export function normalizeCatalogUrlKey(url: string, type: PlaylistType): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (type === "youtube") {
    const vid = getYouTubeVideoId(u);
    return vid ? `https://www.youtube.com/watch?v=${vid}` : u;
  }
  return u;
}

function deriveProvider(url: string, videoId: string | null): string {
  if (videoId) return "youtube";
  if (/soundcloud\.com/i.test(url)) return "soundcloud";
  return "direct";
}

/** Derive a genres array from a title. Returns [] if genre is "Mixed" (unrecognised). */
function genresFromTitle(title: string): string[] {
  const g = inferGenre(title);
  return g !== "Mixed" ? [g] : [];
}

/**
 * Find or create a catalog item, deduplicating by videoId first (YouTube),
 * then by canonicalUrl, then by legacy url field.
 * tenantId is accepted for API compatibility but ignored — catalog is global.
 */
export async function findOrCreateCatalogItem(input: {
  tenantId: string;   // kept for drop-in compat; not stored
  urlKey: string;
  type: PlaylistType; // kept for drop-in compat; not stored
  title: string;
  thumbnailUrl: string;
}): Promise<{ id: string }> {
  const raw = input.urlKey.trim();
  if (!raw) throw new Error("urlKey is required");

  // Derive all dedup keys server-side — callers may pass any URL variant
  const videoId = getYouTubeVideoId(raw) ?? null;
  const canonicalUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : raw;
  const provider = deriveProvider(raw, videoId);

  const title = (input.title ?? "").trim() || "Untitled";
  const thumbnail = (input.thumbnailUrl ?? "").trim() || null;
  const genres = genresFromTitle(title);

  return prisma.$transaction(async (tx) => {
    // 1. YouTube dedup: videoId catches all URL variants for the same video
    if (videoId) {
      const byVideoId = await tx.catalogItem.findFirst({
        where: { videoId },
        select: { id: true, canonicalUrl: true, provider: true, genres: true },
      });
      if (byVideoId) {
        await tx.catalogItem.update({
          where: { id: byVideoId.id },
          data: {
            ...(byVideoId.canonicalUrl ? {} : { canonicalUrl }),
            ...(byVideoId.provider ? {} : { provider }),
            ...((byVideoId.genres ?? []).length === 0 && genres.length > 0 ? { genres } : {}),
          },
        });
        return { id: byVideoId.id };
      }
    }

    // 2. Check by canonicalUrl or legacy url (handles rows from before this migration)
    const existing = await tx.catalogItem.findFirst({
      where: { OR: [{ canonicalUrl }, { url: canonicalUrl }] },
      select: { id: true, canonicalUrl: true, provider: true, videoId: true, genres: true },
    });
    if (existing) {
      await tx.catalogItem.update({
        where: { id: existing.id },
        data: {
          ...(existing.canonicalUrl ? {} : { canonicalUrl }),
          ...(existing.provider ? {} : { provider }),
          ...(existing.videoId ? {} : videoId ? { videoId } : {}),
          ...((existing.genres ?? []).length === 0 && genres.length > 0 ? { genres } : {}),
        },
      });
      return { id: existing.id };
    }

    // 3. Create new
    const created = await tx.catalogItem.create({
      data: { url: canonicalUrl, canonicalUrl, videoId, provider, title, thumbnail, genres },
      select: { id: true },
    });
    return { id: created.id };
  });
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
