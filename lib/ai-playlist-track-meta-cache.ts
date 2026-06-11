/**
 * Session-scoped cache for per-track display metadata returned by the AI
 * playlist build endpoint.
 *
 * Why this exists: `PlaylistItem` in Postgres has no JSON column for taxonomy.
 * To avoid a schema migration for the pilot, we stash the `tracksMeta` map
 * returned by `POST /api/playlists/ai-build` here keyed by `playlistId`. The
 * renderer's track row / Now Playing chip resolver checks this cache (after
 * the track-level fields it already received via the build call) so chips
 * survive in-session navigation between the DJ Creator hub, the edit form,
 * the mobile track list, and the player.
 *
 * Persists to `window.sessionStorage` so a soft reload keeps the chips
 * visible. Capped at 32 playlists to avoid unbounded growth. Not exposed
 * across origins.
 */

import type { PlaylistTrackMetadataSource } from "@/lib/playlist-types";
import type { SessionTrackMetaCache } from "@/lib/playlist-track-display-meta";

const STORAGE_KEY = "syncbiz_ai_playlist_track_meta_cache_v1";
const MAX_PLAYLISTS = 32;

export type AiPlaylistTrackMetaCacheEntry = {
  genre?: string | null;
  mood?: string | null;
  subGenres?: string[] | null;
  metadataSource?: PlaylistTrackMetadataSource | null;
};

export type AiPlaylistTrackMetaCacheMap = Record<string, AiPlaylistTrackMetaCacheEntry>;

type StoredShape = {
  v: 1;
  /** Most-recently-built first. */
  order: string[];
  byPlaylistId: Record<string, AiPlaylistTrackMetaCacheMap>;
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

const EMPTY_STORED: StoredShape = { v: 1, order: [], byPlaylistId: {} };

let memoryStorageRaw: string | null | undefined;
let memoryStored: StoredShape | null = null;
const metaByPlaylistId = new Map<string, SessionTrackMetaCache>();

export function invalidateAiPlaylistTracksMetaMemory(playlistId?: string): void {
  if (playlistId) metaByPlaylistId.delete(playlistId);
  else metaByPlaylistId.clear();
}

function parseStoredRaw(raw: string | null): StoredShape {
  if (!raw) return EMPTY_STORED;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY_STORED;
    const p = parsed as Partial<StoredShape>;
    if (p.v !== 1 || !Array.isArray(p.order) || !p.byPlaylistId) {
      return EMPTY_STORED;
    }
    return p as StoredShape;
  } catch {
    return EMPTY_STORED;
  }
}

function loadStored(): StoredShape {
  if (!isBrowser()) return EMPTY_STORED;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY_STORED;
  }
  if (memoryStorageRaw === raw && memoryStored) return memoryStored;
  memoryStorageRaw = raw;
  memoryStored = parseStoredRaw(raw);
  return memoryStored;
}

function bumpMemoryAfterWrite(next: StoredShape): void {
  memoryStored = next;
  try {
    memoryStorageRaw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    memoryStorageRaw = JSON.stringify(next);
  }
}

function writeStored(s: StoredShape): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // sessionStorage may be full or disabled — degrade gracefully.
  }
}

function sanitizeEntry(raw: unknown): AiPlaylistTrackMetaCacheEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: AiPlaylistTrackMetaCacheEntry = {};
  if (typeof r.genre === "string" && r.genre.trim()) out.genre = r.genre.trim();
  if (typeof r.mood === "string" && r.mood.trim()) out.mood = r.mood.trim();
  if (Array.isArray(r.subGenres)) {
    const sg = r.subGenres.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (sg.length > 0) out.subGenres = sg;
  }
  if (typeof r.metadataSource === "string") {
    const ms = r.metadataSource as PlaylistTrackMetadataSource;
    if (ms === "local_id3" || ms === "local_xlsx" || ms === "catalog" || ms === "playlist" || ms === "fallback") {
      out.metadataSource = ms;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Store the `tracksMeta` map returned by the AI build response for `playlistId`. */
export function storeAiPlaylistTracksMeta(
  playlistId: string,
  tracksMeta: unknown,
): void {
  if (!playlistId || !tracksMeta || typeof tracksMeta !== "object") return;
  const sanitized: AiPlaylistTrackMetaCacheMap = {};
  for (const [trackId, entry] of Object.entries(tracksMeta as Record<string, unknown>)) {
    const e = sanitizeEntry(entry);
    if (e) sanitized[trackId] = e;
  }
  if (Object.keys(sanitized).length === 0) return;

  const stored = loadStored();
  const next: StoredShape = {
    v: 1,
    order: [playlistId, ...stored.order.filter((id) => id !== playlistId)].slice(0, MAX_PLAYLISTS),
    byPlaylistId: { ...stored.byPlaylistId, [playlistId]: sanitized },
  };
  // Trim any orphaned entries past the order cap.
  for (const key of Object.keys(next.byPlaylistId)) {
    if (!next.order.includes(key)) delete next.byPlaylistId[key];
  }
  writeStored(next);
  bumpMemoryAfterWrite(next);
  invalidateAiPlaylistTracksMetaMemory(playlistId);
}

/** Look up the cached `tracksMeta` map for a playlist. Empty when nothing was stored. */
export function getCachedAiPlaylistTracksMeta(
  playlistId: string | null | undefined,
): SessionTrackMetaCache {
  if (!playlistId) return {};
  const stored = loadStored();
  return stored.byPlaylistId[playlistId] ?? {};
}

/** Test/utility: clear all cached track metadata. */
export function clearAiPlaylistTracksMetaCache(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  memoryStorageRaw = null;
  memoryStored = null;
  invalidateAiPlaylistTracksMetaMemory();
}

/** Memoized lookup for grid leaf chips (avoids re-parsing sessionStorage per card). */
export function getMemoizedAiPlaylistTracksMeta(
  playlistId: string | null | undefined,
): SessionTrackMetaCache {
  if (!playlistId) return {};
  const hit = metaByPlaylistId.get(playlistId);
  if (hit) return hit;
  const meta = getCachedAiPlaylistTracksMeta(playlistId);
  metaByPlaylistId.set(playlistId, meta);
  return meta;
}
