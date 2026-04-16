/**
 * CatalogItem storage — backed by PostgreSQL via Prisma.
 * CatalogItem is GLOBAL (no workspaceId / tenantId).
 * Replaces the previous file-per-item JSON implementation.
 */

import { prisma } from "./prisma";
import type { PlaylistType } from "./playlist-types";
import { canonicalYouTubeWatchUrlForPlayback } from "./playlist-utils";

export function normalizeCatalogUrlKey(url: string, type: PlaylistType): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (type === "youtube") return canonicalYouTubeWatchUrlForPlayback(u).trim();
  return u;
}

/**
 * Find or create a catalog item by its normalized URL.
 * tenantId is accepted for API compatibility but ignored — catalog is global.
 * Returns at minimum `{ id }` — callers that only need the id continue to work.
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

  const row = await prisma.catalogItem.upsert({
    where: { url },
    create: { url, title, thumbnail },
    update: {
      ...(title !== "Untitled" ? { title } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    },
  });

  return { id: row.id };
}
