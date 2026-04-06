/**
 * File-based CatalogItem storage (Phase 1). Additive; playlists remain authoritative for playback URLs.
 */

import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getCatalogDir } from "./data-path";
import type { CatalogItem } from "./catalog-types";
import type { PlaylistType } from "./playlist-types";
import { canonicalYouTubeWatchUrlForPlayback } from "./playlist-utils";

export function normalizeCatalogUrlKey(url: string, type: PlaylistType): string {
  const u = (url ?? "").trim();
  if (!u) return "";
  if (type === "youtube") return canonicalYouTubeWatchUrlForPlayback(u).trim();
  return u;
}

function generateCatalogId(): string {
  return `cat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function catalogItemPath(id: string): string {
  return join(getCatalogDir(), `${id}.json`);
}

async function ensureCatalogDir(): Promise<void> {
  await mkdir(getCatalogDir(), { recursive: true });
}

async function listCatalogJsonFilenames(): Promise<string[]> {
  try {
    const names = await readdir(getCatalogDir());
    return names.filter((f) => f.startsWith("cat-") && f.endsWith(".json"));
  } catch {
    return [];
  }
}

export async function findCatalogItemByUrlKey(
  tenantId: string,
  urlKey: string,
): Promise<CatalogItem | null> {
  const tid = tenantId.trim();
  const key = urlKey.trim();
  if (!tid || !key) return null;
  const files = await listCatalogJsonFilenames();
  for (const file of files) {
    try {
      const raw = await readFile(join(getCatalogDir(), file), "utf-8");
      const row = JSON.parse(raw) as CatalogItem;
      if (row.tenantId === tid && row.urlKey === key) return row;
    } catch {
      /* skip */
    }
  }
  return null;
}

export async function findOrCreateCatalogItem(input: {
  tenantId: string;
  urlKey: string;
  type: PlaylistType;
  title: string;
  thumbnailUrl: string;
}): Promise<CatalogItem> {
  await ensureCatalogDir();
  const tid = input.tenantId.trim();
  const urlKey = input.urlKey.trim();
  if (!tid || !urlKey) {
    throw new Error("tenantId and urlKey are required");
  }
  const existing = await findCatalogItemByUrlKey(tid, urlKey);
  if (existing) {
    const now = new Date().toISOString();
    const title = (input.title ?? "").trim() || existing.title;
    const thumbnailUrl = (input.thumbnailUrl ?? "").trim();
    const next: CatalogItem = {
      ...existing,
      title: title || existing.title,
      thumbnailUrl: thumbnailUrl || existing.thumbnailUrl,
      updatedAt: now,
    };
    if (next.title !== existing.title || next.thumbnailUrl !== existing.thumbnailUrl) {
      await writeFile(catalogItemPath(existing.id), JSON.stringify(next, null, 2), "utf-8");
    }
    return next;
  }
  const now = new Date().toISOString();
  const id = generateCatalogId();
  const row: CatalogItem = {
    id,
    tenantId: tid,
    urlKey,
    type: input.type,
    title: (input.title ?? "").trim() || "Untitled",
    thumbnailUrl: (input.thumbnailUrl ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(catalogItemPath(id), JSON.stringify(row, null, 2), "utf-8");
  return row;
}
