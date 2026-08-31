/**
 * Server-side Music Bank asset map (Stage A / POC). Maps an opaque assetId to where its bytes live
 * and which genre/access-mode it belongs to — the media endpoint's scope + lookup source.
 *
 * This is the ONLY thing the media endpoint consults per request (plus HMAC verify): NO DB, no Prisma,
 * no Drive metadata discovery, no playlist query. Built once from the preview-cache manifest and cached
 * in memory (reloaded only if the manifest file changes).
 *
 * POC byte source = the local preview cache (already-downloaded sample bytes). The `provider` field is
 * the storage-provider seam: today "local-preview"; a future "drive"/"r2"/"s3" provider plugs in with
 * the same MediaAsset shape and server-side credentials — the catalog/player/token model do not change.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type MediaProvider = "local-preview" | "drive" | "r2" | "s3";

export type MediaAsset = {
  assetId: string;
  genreId: string;
  provider: MediaProvider;
  /** For local-preview: the cache-relative filename. For drive/r2/s3: the object key (server-side only). */
  providerKey: string;
  mimeType: string;
  size: number;
  checksum: string | null;
  durationSeconds: number | null;
};

function mimeFromName(name: string): string {
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
  switch (ext) {
    case ".mp3": return "audio/mpeg";
    case ".m4a": case ".mp4": return "audio/mp4";
    case ".wav": return "audio/wav";
    case ".flac": return "audio/flac";
    case ".ogg": case ".oga": return "audio/ogg";
    case ".aac": return "audio/aac";
    default: return "audio/mpeg";
  }
}

/** Resolve the preview-cache directory (contains manifest.json + the .mp3 bytes). null if not present. */
function resolveCacheBase(): string | null {
  const cwd = process.cwd();
  const candidates = [
    process.env.POC_PREVIEW_CACHE_ROOT, // explicit override (tests / non-default local layout)
    path.join(cwd, "desktop", ".poc-preview-cache"),
    path.join(cwd, ".poc-preview-cache"),
    path.resolve(cwd, "..", "..", "desktop", ".poc-preview-cache"), // embedded staged-web → repo root
    path.resolve(cwd, "..", "desktop", ".poc-preview-cache"),
  ].filter((c): c is string => !!c);
  return candidates.find((c) => existsSync(path.join(c, "manifest.json"))) ?? null;
}

type ManifestAsset = {
  name?: string; size?: number; contentHash?: string; genreId?: string;
  localPath?: string; durationSeconds?: number | null; status?: string; ext?: string;
  /** SyncBiz public logicalId (stamped by the catalog builder). The map is keyed by THIS, not the
   *  manifest key — so /api/media/<logicalId> resolves even after a re-upload changes the cache key. */
  logicalId?: string;
};

let cache: { base: string; mtimeMs: number; map: Map<string, MediaAsset>; genres: Set<string> } | null = null;

function loadIfNeeded(): typeof cache {
  const base = resolveCacheBase();
  if (!base) { cache = null; return null; }
  const manifestPath = path.join(base, "manifest.json");
  let mtimeMs: number;
  try { mtimeMs = statSync(manifestPath).mtimeMs; } catch { cache = null; return null; }
  if (cache && cache.base === base && cache.mtimeMs === mtimeMs) return cache;

  let raw: { assets?: Record<string, ManifestAsset> };
  try { raw = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { cache = null; return null; }
  const map = new Map<string, MediaAsset>();
  const genres = new Set<string>();
  for (const [assetId, a] of Object.entries(raw.assets ?? {})) {
    if (!a || a.status !== "ready" || !a.localPath || !a.genreId) continue;
    // Public lookup is by SyncBiz logicalId; the manifest KEY is only a cache filename handle. They
    // coincide for the legacy 176 but diverge after a re-upload — so key by logicalId (fallback: key).
    const publicId = a.logicalId || assetId;
    map.set(publicId, {
      assetId: publicId,
      genreId: a.genreId,
      provider: "local-preview",
      providerKey: a.localPath,
      mimeType: mimeFromName(a.name || a.localPath),
      size: typeof a.size === "number" ? a.size : 0,
      checksum: a.contentHash ?? null,
      durationSeconds: typeof a.durationSeconds === "number" ? a.durationSeconds : null,
    });
    genres.add(a.genreId);
  }
  cache = { base, mtimeMs, map, genres };
  return cache;
}

/**
 * Whether the in-memory preview-cache (POC) path may serve bytes / define token scope. This is a
 * DEV/TEST convenience only: hard OFF when NODE_ENV=production (no env re-enables it in prod), on in
 * dev unless SYNCBIZ_MEDIA_POC_FALLBACK=0. In production the DB MediaAsset is the ONE source of
 * playable media and the ONLY source of token scope. Single source of truth for this policy (used by
 * the /api/media route and the Music Bank authorize route).
 */
export function pocMediaFallbackAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.SYNCBIZ_MEDIA_POC_FALLBACK !== "0";
}

/** Look up an asset by opaque id. Returns null if unknown (→ endpoint 404). In-memory, no DB. */
export function getMediaAsset(assetId: string): MediaAsset | null {
  const c = loadIfNeeded();
  return c ? c.map.get(assetId) ?? null : null;
}

/** All preview genre ids currently available — the server-authoritative scope for a preview token. */
export function allPreviewGenreIds(): string[] {
  const c = loadIfNeeded();
  return c ? [...c.genres] : [];
}

/** Absolute on-disk path for a local-preview asset (server only). null if the file is missing. */
export function resolveLocalPreviewPath(asset: MediaAsset): string | null {
  const c = loadIfNeeded();
  if (!c || asset.provider !== "local-preview") return null;
  const abs = path.join(c.base, asset.providerKey);
  return existsSync(abs) ? abs : null;
}
