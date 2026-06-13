/**
 * Stage 4A — Desktop-only local collection snapshot (metadata + paths, never synced to server).
 *
 * Canonical track id v1 (device-local only, not cross-device identity):
 *   v1:{encodeURIComponent(normalizedRelPath)}:{size}:{mtimeMs}
 * where normalizedRelPath uses forward slashes relative to the configured music folder root.
 * Extend with a v2 prefix if the formula changes — not stable across renames without rescan.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  DesktopRuntimeConfig,
  ListMusicLibraryDirResult,
  LocalAiPlaylistCandidate,
  LocalAudioTagFields,
  LocalCollectionSearchHit,
} from "../shared/mvp-types";
import {
  expandLocalSearchTokens,
  scoreLocalTrackForAiSearch,
  toLocalAiSearchMatchDebug,
  rankLocalAiSearchResults,
  parseLocalSearchIntents,
} from "../shared/local-ai-playlist-search";

/**
 * Schema v2 (Phase 1 hybrid AI playlist): adds `comment`, `bpm`, `rating` to each row.
 * Existing v1 snapshots are reset by ensureLocalCollectionSnapshot so the new fields populate cleanly.
 */
export const LOCAL_COLLECTION_SCHEMA_VERSION = 2;

const SNAPSHOT_SUBDIR = "local-collection";
const SNAPSHOT_FILENAME = "collection-snapshot.json";

const LOG = "[SyncBiz:local-collection-snapshot]";

/** One indexed audio file under the configured music folder. */
export type LocalCollectionTrackRecord = {
  /** Same as snapshot.tracks key — v1 canonical local id. */
  localId: string;
  absolutePath: string;
  relativePathFromRoot: string;
  size: number;
  mtimeMs: number;
  artist: string | null;
  title: string | null;
  genre: string | null;
  year: string | null;
  album: string | null;
  durationSec: number | null;
  /** ID3 comment frame (joined when multi-value). Schema v2+. */
  comment: string | null;
  /** Tagged BPM only (no audio analysis). Schema v2+. */
  bpm: number | null;
  /** 0–5 star rating averaged across sources. Schema v2+. */
  rating: number | null;
  /** Tag&Rename / metadata bank track # when imported. */
  trackNumber?: string | null;
  /**
   * Absolute root path this row was indexed against. Pilot multi-root model
   * (PlaylistPro + Additional Music Folders) — when absent the row was
   * imported under the snapshot's primary `musicFolderRoot`.
   */
  rootPath?: string | null;
  /** Future: link to SyncBiz CatalogItem when matched online. */
  catalogItemId?: string | null;
  /** Future: preferred streaming URL when known. */
  youtubeUrl?: string | null;
  externalUrl?: string | null;
  /** Future: ranked URL candidates for operator matching. */
  urlCandidates?: Array<{ url: string; source?: string; score?: number }> | null;
  /** When this row was first seen or refreshed from a directory listing / scan. */
  lastScannedAt: string;
  /** When file stats were last confirmed (listing, scan, or tag read). */
  lastVerifiedAt: string;
};

export type LocalCollectionSnapshotFile = {
  schemaVersion: number;
  /** Reserved; set when the desktop knows a real workspace id (optional future). */
  workspaceId: string | null;
  deviceId: string;
  /** Normalized absolute path of the music library root when last written. */
  musicFolderRoot: string | null;
  tracks: Record<string, LocalCollectionTrackRecord>;
  updatedAt: string;
  /**
   * Pilot: ISO timestamp of the most recent "Scan now" per indexed root path.
   * Keys are lower-cased absolute paths so the UI can show "last scan" per
   * source even when no tracks were indexed. Optional for backwards compat.
   */
  rootScanTimestamps?: Record<string, string>;
};

export type LocalCollectionSnapshotStats = {
  trackCount: number;
  updatedAt: string;
  musicFolderRoot: string | null;
};

function snapshotPath(userData: string, deviceId: string): string {
  const safe = (deviceId ?? "").trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown-device";
  return path.join(userData, SNAPSHOT_SUBDIR, safe, SNAPSHOT_FILENAME);
}

function normalizeMusicRoot(root: string | null | undefined): string | null {
  const t = (root ?? "").trim();
  if (!t) return null;
  return path.resolve(t);
}

/** Forward slashes, no leading slash; used with encodeURIComponent in the v1 id. */
export function normalizeRelativePathForSnapshot(rel: string): string {
  const raw = (rel ?? "").replace(/^[\\/]+/, "").trim();
  if (!raw) return "";
  return raw.split(/[/\\]+/).filter((s) => s.length > 0 && s !== "." && s !== "..").join("/");
}

export function computeLocalTrackCanonicalIdV1(
  relativePathFromRoot: string,
  size: number,
  mtimeMs: number,
): string {
  const relNorm = normalizeRelativePathForSnapshot(relativePathFromRoot);
  return `v1:${encodeURIComponent(relNorm)}:${size}:${mtimeMs}`;
}

function relativeFromMusicRoot(absolutePath: string, rootNorm: string): string | null {
  const abs = path.resolve(absolutePath);
  const rel = path.relative(rootNorm, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return normalizeRelativePathForSnapshot(rel);
}

function freshSnapshot(deviceId: string, musicRoot: string | null): LocalCollectionSnapshotFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: LOCAL_COLLECTION_SCHEMA_VERSION,
    workspaceId: null,
    deviceId: deviceId.trim() || "unknown",
    musicFolderRoot: musicRoot,
    tracks: {},
    updatedAt: now,
    rootScanTimestamps: {},
  };
}

type SnapshotCacheEntry = {
  userData: string;
  deviceId: string;
  mtimeMs: number;
  snap: LocalCollectionSnapshotFile;
};

let snapshotMemoryCache: SnapshotCacheEntry | null = null;

export function invalidateLocalCollectionSnapshotCache(): void {
  snapshotMemoryCache = null;
}

function snapshotFileMtimeMs(userData: string, deviceId: string): number {
  const p = snapshotPath(userData, deviceId);
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** In-memory snapshot for hot IPC search paths; invalidated on save and explicit scan. */
export function loadLocalCollectionSnapshotCached(
  userData: string,
  deviceId: string,
): LocalCollectionSnapshotFile | null {
  const mtimeMs = snapshotFileMtimeMs(userData, deviceId);
  if (
    snapshotMemoryCache &&
    snapshotMemoryCache.userData === userData &&
    snapshotMemoryCache.deviceId === deviceId &&
    snapshotMemoryCache.mtimeMs === mtimeMs
  ) {
    return snapshotMemoryCache.snap;
  }
  const snap = loadLocalCollectionSnapshot(userData, deviceId);
  if (snap && mtimeMs > 0) {
    snapshotMemoryCache = { userData, deviceId, mtimeMs, snap };
  } else {
    snapshotMemoryCache = null;
  }
  return snap;
}

export function loadLocalCollectionSnapshot(userData: string, deviceId: string): LocalCollectionSnapshotFile | null {
  const p = snapshotPath(userData, deviceId);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf-8");
    const data = JSON.parse(raw) as Partial<LocalCollectionSnapshotFile>;
    if (!data || typeof data !== "object") return null;
    const tracks =
      data.tracks && typeof data.tracks === "object" && !Array.isArray(data.tracks)
        ? (data.tracks as Record<string, LocalCollectionTrackRecord>)
        : {};
    const rootScanTimestamps: Record<string, string> = {};
    if (
      data.rootScanTimestamps &&
      typeof data.rootScanTimestamps === "object" &&
      !Array.isArray(data.rootScanTimestamps)
    ) {
      for (const [k, v] of Object.entries(data.rootScanTimestamps as Record<string, unknown>)) {
        if (typeof k === "string" && k.length > 0 && typeof v === "string" && v.length > 0) {
          rootScanTimestamps[k.toLowerCase()] = v;
        }
      }
    }
    return {
      schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : LOCAL_COLLECTION_SCHEMA_VERSION,
      workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : null,
      deviceId: typeof data.deviceId === "string" && data.deviceId.trim() ? data.deviceId.trim() : deviceId.trim(),
      musicFolderRoot:
        typeof data.musicFolderRoot === "string" && data.musicFolderRoot.trim()
          ? data.musicFolderRoot.trim()
          : null,
      tracks,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
      rootScanTimestamps,
    };
  } catch {
    return null;
  }
}

/** Compact JSON keeps large libraries (500–1000+ tracks) smaller and faster to write than pretty-print. */
export function saveLocalCollectionSnapshot(userData: string, snapshot: LocalCollectionSnapshotFile): void {
  try {
    const dir = path.dirname(snapshotPath(userData, snapshot.deviceId));
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    const toWrite: LocalCollectionSnapshotFile = { ...snapshot, updatedAt: now };
    writeFileSync(snapshotPath(userData, snapshot.deviceId), JSON.stringify(toWrite), "utf-8");
    invalidateLocalCollectionSnapshotCache();
  } catch (e) {
    console.warn(LOG, "snapshot write failed (ignored)", e);
  }
}

/**
 * Load or create snapshot; align device/root; reset tracks if schema or root changed.
 */
export function ensureLocalCollectionSnapshot(
  userData: string,
  config: DesktopRuntimeConfig,
): LocalCollectionSnapshotFile {
  const deviceId = (config.deviceId ?? "").trim() || "unknown";
  const rootNorm = normalizeMusicRoot(config.musicFolderPath ?? null);

  const existing = loadLocalCollectionSnapshot(userData, deviceId);
  let snap: LocalCollectionSnapshotFile;
  if (!existing) {
    snap = freshSnapshot(deviceId, rootNorm);
    saveLocalCollectionSnapshot(userData, snap);
    return snap;
  }

  snap = existing;
  if (snap.schemaVersion !== LOCAL_COLLECTION_SCHEMA_VERSION) {
    snap = {
      ...freshSnapshot(deviceId, rootNorm),
      tracks: {},
    };
    saveLocalCollectionSnapshot(userData, snap);
    return snap;
  }

  const prevRoot = snap.musicFolderRoot ? path.resolve(snap.musicFolderRoot) : null;
  const nextRootResolved = rootNorm ? path.resolve(rootNorm) : null;
  const rootChanged = (prevRoot ?? null) !== (nextRootResolved ?? null);
  const deviceMatches = (snap.deviceId ?? "").trim() === (deviceId ?? "").trim();
  if (!rootChanged && deviceMatches) {
    return snap;
  }
  snap = {
    ...snap,
    deviceId,
    workspaceId: snap.workspaceId ?? null,
    musicFolderRoot: rootNorm,
    ...(rootChanged ? { tracks: {} } : {}),
  };
  saveLocalCollectionSnapshot(userData, snap);
  return snap;
}

function removeStaleKeysForAbsolutePath(snapshot: LocalCollectionSnapshotFile, absolutePath: string, keepKey: string): void {
  const abs = path.resolve(absolutePath);
  for (const k of Object.keys(snapshot.tracks)) {
    if (k === keepKey) continue;
    if (path.resolve(snapshot.tracks[k].absolutePath) === abs) {
      delete snapshot.tracks[k];
    }
  }
}

function mergeTagField<T extends string | null>(
  incoming: T | undefined,
  previous: T | null | undefined,
  preserve: boolean,
): T | null {
  if (incoming !== undefined) return incoming ?? null;
  if (preserve && previous !== undefined && previous !== null) return previous;
  if (preserve && previous === null) return null;
  return previous ?? null;
}

function mergeDuration(
  incoming: number | null | undefined,
  previous: number | null | undefined,
  preserve: boolean,
): number | null {
  if (incoming !== undefined) return incoming ?? null;
  if (preserve && previous !== undefined && previous !== null) return previous;
  if (preserve && previous === null) return null;
  return previous ?? null;
}

export function upsertLocalTrackIntoSnapshot(
  snapshot: LocalCollectionSnapshotFile,
  args: {
    absolutePath: string;
    musicRootNorm: string | null;
    size: number;
    mtimeMs: number;
    tags?: Partial<LocalAudioTagFields> | null;
    /** When true and the same localId already exists, keep prior tag fields if `tags` omits them. */
    preserveTagsOnStatOnly?: boolean;
    /** When true, set `lastScannedAt` to now (directory listing or recursive scan). */
    touchScannedAt?: boolean;
  },
): void {
  const rootNorm = args.musicRootNorm;
  if (!rootNorm) return;

  const rel = relativeFromMusicRoot(args.absolutePath, rootNorm);
  if (!rel) return;

  const localId = computeLocalTrackCanonicalIdV1(rel, args.size, args.mtimeMs);
  const now = new Date().toISOString();
  const prev = snapshot.tracks[localId];
  const tag = args.tags ?? {};
  const preserve = args.preserveTagsOnStatOnly === true && !!prev;

  removeStaleKeysForAbsolutePath(snapshot, args.absolutePath, localId);

  const artist = mergeTagField(tag.artist, prev?.artist, preserve);
  const title = mergeTagField(tag.title, prev?.title, preserve);
  const genre = mergeTagField(tag.genre, prev?.genre, preserve);
  const year = mergeTagField(tag.year, prev?.year, preserve);
  const album = mergeTagField(tag.album, prev?.album, preserve);
  const comment = mergeTagField(tag.comment, prev?.comment, preserve);
  const durationSec = mergeDuration(tag.durationSec, prev?.durationSec, preserve);
  const bpm = mergeDuration(tag.bpm, prev?.bpm, preserve);
  const rating = mergeDuration(tag.rating, prev?.rating, preserve);
  const trackNumber = mergeTagField(tag.trackNumber, prev?.trackNumber, preserve);

  const lastScannedAt = args.touchScannedAt ? now : prev?.lastScannedAt ?? now;

  snapshot.tracks[localId] = {
    localId,
    absolutePath: path.resolve(args.absolutePath),
    relativePathFromRoot: rel,
    size: args.size,
    mtimeMs: args.mtimeMs,
    artist,
    title,
    genre,
    year,
    album,
    comment,
    bpm,
    rating,
    trackNumber,
    durationSec,
    rootPath: rootNorm,
    lastScannedAt,
    lastVerifiedAt: now,
  };

  snapshot.updatedAt = now;
}

/**
 * Pilot multi-root: upsert a track row from an "Additional Music Folder" root.
 * Uses a distinct `extra:` localId namespace so the same relative-path/size/mtime
 * triple under PlaylistPro and an extra folder produce separate rows. We keep
 * the relative path computed against the extra root for friendly display.
 */
function localIdForExtraRoot(
  rootNorm: string,
  rel: string,
  size: number,
  mtimeMs: number,
): string {
  const rootHash = createHash("sha1").update(rootNorm.toLowerCase()).digest("hex").slice(0, 12);
  return `extra:v1:${rootHash}:${encodeURIComponent(rel)}:${size}:${mtimeMs}`;
}

function relativeFromExtraRoot(absolutePath: string, rootNorm: string): string | null {
  const abs = path.resolve(absolutePath);
  const rel = path.relative(rootNorm, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return normalizeRelativePathForSnapshot(rel);
}

export function upsertExtraRootTrackIntoSnapshot(
  snapshot: LocalCollectionSnapshotFile,
  args: {
    absolutePath: string;
    extraRootNorm: string;
    size: number;
    mtimeMs: number;
    tags?: Partial<LocalAudioTagFields> | null;
    preserveTagsOnStatOnly?: boolean;
    touchScannedAt?: boolean;
  },
): void {
  const rootNorm = args.extraRootNorm;
  if (!rootNorm) return;

  const rel = relativeFromExtraRoot(args.absolutePath, rootNorm);
  if (!rel) return;

  const localId = localIdForExtraRoot(rootNorm, rel, args.size, args.mtimeMs);
  const now = new Date().toISOString();
  const prev = snapshot.tracks[localId];
  const tag = args.tags ?? {};
  const preserve = args.preserveTagsOnStatOnly === true && !!prev;

  removeStaleKeysForAbsolutePath(snapshot, args.absolutePath, localId);

  const artist = mergeTagField(tag.artist, prev?.artist, preserve);
  const title = mergeTagField(tag.title, prev?.title, preserve);
  const genre = mergeTagField(tag.genre, prev?.genre, preserve);
  const year = mergeTagField(tag.year, prev?.year, preserve);
  const album = mergeTagField(tag.album, prev?.album, preserve);
  const comment = mergeTagField(tag.comment, prev?.comment, preserve);
  const durationSec = mergeDuration(tag.durationSec, prev?.durationSec, preserve);
  const bpm = mergeDuration(tag.bpm, prev?.bpm, preserve);
  const rating = mergeDuration(tag.rating, prev?.rating, preserve);
  const trackNumber = mergeTagField(tag.trackNumber, prev?.trackNumber, preserve);

  const lastScannedAt = args.touchScannedAt ? now : prev?.lastScannedAt ?? now;

  snapshot.tracks[localId] = {
    localId,
    absolutePath: path.resolve(args.absolutePath),
    relativePathFromRoot: rel,
    size: args.size,
    mtimeMs: args.mtimeMs,
    artist,
    title,
    genre,
    year,
    album,
    comment,
    bpm,
    rating,
    trackNumber,
    durationSec,
    rootPath: rootNorm,
    lastScannedAt,
    lastVerifiedAt: now,
  };

  snapshot.updatedAt = now;
}

/**
 * After a recursive scan of an Additional Music Folder root, index its files
 * into the snapshot using the multi-root upsert path. Returns nothing — the
 * snapshot file is written once at the end.
 *
 * Pilot Blocker (Local Jazz strictness): when `tagsByAbsPath` is provided,
 * each row gets its real ID3 / metadata tags written into the snapshot during
 * the scan (instead of needing a separate My-Music-Library browse pass or an
 * XLSX import to populate Genre / Artist / Title). When omitted, the legacy
 * "paths-only" behavior is preserved.
 */
export async function recordExtraRootScanInSnapshot(
  userData: string,
  config: DesktopRuntimeConfig,
  rootPath: string,
  absolutePaths: string[],
  tagsByAbsPath?: ReadonlyMap<string, LocalAudioTagFields | null>,
): Promise<void> {
  const rootNorm = path.resolve((rootPath ?? "").trim());
  if (!rootNorm || absolutePaths.length === 0) return;
  try {
    const snap = ensureLocalCollectionSnapshot(userData, config);
    for (const raw of absolutePaths) {
      const p = (raw ?? "").trim();
      if (!p) continue;
      let st;
      try {
        st = await stat(p);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const incomingTags = tagsByAbsPath?.get(path.resolve(p)) ?? null;
      upsertExtraRootTrackIntoSnapshot(snap, {
        absolutePath: p,
        extraRootNorm: rootNorm,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
        tags: incomingTags ?? undefined,
        preserveTagsOnStatOnly: !incomingTags,
        touchScannedAt: true,
      });
    }
    setSnapshotLastScanForRoot(snap, rootPath, new Date().toISOString());
    saveLocalCollectionSnapshot(userData, snap);
  } catch (e) {
    console.warn(LOG, "extra-root scan snapshot failed", e);
  }
}

/** Touch the per-root last-scan timestamp without rewriting any track rows. */
export function setSnapshotLastScanForRoot(
  snapshot: LocalCollectionSnapshotFile,
  rootPath: string | null | undefined,
  iso: string,
): void {
  const p = (rootPath ?? "").trim();
  if (!p) return;
  const map = snapshot.rootScanTimestamps ?? {};
  map[path.resolve(p).toLowerCase()] = iso;
  snapshot.rootScanTimestamps = map;
}

export function listSnapshotTracksForRoot(
  snapshot: LocalCollectionSnapshotFile,
  relativePathPrefix?: string,
): LocalCollectionTrackRecord[] {
  const prefix = normalizeRelativePathForSnapshot((relativePathPrefix ?? "").trim().replace(/^[\\/]+/, ""));
  const rows = Object.values(snapshot.tracks);
  if (!prefix) {
    return rows.sort((a, b) => a.relativePathFromRoot.localeCompare(b.relativePathFromRoot, undefined, { numeric: true }));
  }
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return rows
    .filter((r) => r.relativePathFromRoot === prefix || r.relativePathFromRoot.startsWith(p))
    .sort((a, b) => a.relativePathFromRoot.localeCompare(b.relativePathFromRoot, undefined, { numeric: true }));
}

export function getSnapshotStats(snapshot: LocalCollectionSnapshotFile): LocalCollectionSnapshotStats {
  return {
    trackCount: Object.keys(snapshot.tracks).length,
    updatedAt: snapshot.updatedAt,
    musicFolderRoot: snapshot.musicFolderRoot,
  };
}

/** Subset stored on list rows for My Music Library (Stage 4B). */
export type ListDirSnapshotTagFields = {
  artist: string | null;
  title: string | null;
  genre: string | null;
  year: string | null;
  album: string | null;
  durationSec: number | null;
};

/**
 * Return snapshot metadata for a file only when disk size/mtime match the snapshot row
 * (otherwise treat cache as stale and let the UI use live tag read).
 */
export function getFreshSnapshotTagsForFile(
  snapshot: LocalCollectionSnapshotFile,
  musicRootNorm: string,
  absolutePath: string,
  size: number,
  mtimeMs: number,
): ListDirSnapshotTagFields | null {
  const rel = relativeFromMusicRoot(absolutePath, musicRootNorm);
  if (!rel) return null;

  const id = computeLocalTrackCanonicalIdV1(rel, size, mtimeMs);
  let row: LocalCollectionTrackRecord | undefined = snapshot.tracks[id];
  if (!row || path.resolve(row.absolutePath) !== path.resolve(absolutePath)) {
    row = undefined;
    for (const r of Object.values(snapshot.tracks)) {
      if (
        path.resolve(r.absolutePath) === path.resolve(absolutePath) &&
        r.size === size &&
        r.mtimeMs === mtimeMs
      ) {
        row = r;
        break;
      }
    }
  }
  if (!row) return null;
  if (row.size !== size || row.mtimeMs !== mtimeMs) return null;
  if (path.resolve(row.absolutePath) !== path.resolve(absolutePath)) return null;

  return {
    artist: row.artist,
    title: row.title,
    genre: row.genre,
    year: row.year,
    album: row.album,
    durationSec: row.durationSec,
  };
}

/**
 * Attach `snapshotTags` to list rows when the on-disk file matches a snapshot entry.
 * If snapshot is missing or has no tracks, returns `result` unchanged.
 */
export async function enrichListMusicLibraryDirWithSnapshot(
  userData: string,
  config: DesktopRuntimeConfig,
  result: ListMusicLibraryDirResult,
): Promise<ListMusicLibraryDirResult> {
  if (result.status !== "ok") return result;
  const deviceId = (config.deviceId ?? "").trim() || "unknown";
  const snap = loadLocalCollectionSnapshot(userData, deviceId);
  const rootNorm = normalizeMusicRoot(config.musicFolderPath ?? null);
  if (!snap || !rootNorm || Object.keys(snap.tracks).length === 0) {
    return result;
  }

  const files = await Promise.all(
    result.files.map(async (f) => {
      const p = (f.path ?? "").trim();
      if (!p) return f;
      try {
        const st = await stat(p);
        if (!st.isFile()) return f;
        const size = st.size;
        const mtimeMs = Math.floor(st.mtimeMs);
        const subset = getFreshSnapshotTagsForFile(snap, rootNorm, p, size, mtimeMs);
        return subset ? { ...f, snapshotTags: subset } : f;
      } catch {
        return f;
      }
    }),
  );
  return { ...result, files };
}

/** Debounced + capped batching: one snapshot load + one disk write per burst (not one per track tag read). */
const TAG_SNAPSHOT_BATCH_MS = 450;
const TAG_SNAPSHOT_BATCH_MAX = 48;

const pendingTagSnapshotWrites = new Map<
  string,
  { userData: string; config: DesktopRuntimeConfig; tags: LocalAudioTagFields }
>();
let tagSnapshotFlushTimer: ReturnType<typeof setTimeout> | undefined;

async function flushPendingTagSnapshots(): Promise<void> {
  if (pendingTagSnapshotWrites.size === 0) return;
  const entries = [...pendingTagSnapshotWrites.entries()];
  pendingTagSnapshotWrites.clear();
  try {
    const groups = new Map<string, { userData: string; config: DesktopRuntimeConfig; paths: Map<string, LocalAudioTagFields> }>();
    for (const [absKey, { userData, config, tags }] of entries) {
      const gk = `${userData}\0${(config.deviceId ?? "").trim() || "unknown"}`;
      let g = groups.get(gk);
      if (!g) {
        g = { userData, config, paths: new Map() };
        groups.set(gk, g);
      }
      g.paths.set(absKey, tags);
    }
    for (const { userData, config, paths } of groups.values()) {
      const snap = ensureLocalCollectionSnapshot(userData, config);
      const rootNorm = normalizeMusicRoot(config.musicFolderPath ?? null);
      if (!rootNorm) continue;
      for (const [absPath, tagFields] of paths) {
        if (!relativeFromMusicRoot(absPath, rootNorm)) continue;
        let st;
        try {
          st = await stat(absPath);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        // Browse-driven ID3 reads typically return null for the XLSX-sourced fields
        // (comment / bpm / rating). Passing `undefined` for null incoming values makes
        // mergeTagField / mergeDuration fall through to "preserve previous" — so a prior
        // Tag&Rename XLSX import for this file is not silently wiped when the user
        // opens it from the My Music Library browse UI.
        upsertLocalTrackIntoSnapshot(snap, {
          absolutePath: absPath,
          musicRootNorm: rootNorm,
          size: st.size,
          mtimeMs: Math.floor(st.mtimeMs),
          tags: {
            artist: tagFields.artist,
            title: tagFields.title,
            album: tagFields.album,
            genre: tagFields.genre,
            year: tagFields.year,
            comment: tagFields.comment ?? undefined,
            durationSec: tagFields.durationSec,
            bpm: tagFields.bpm ?? undefined,
            rating: tagFields.rating ?? undefined,
          },
          preserveTagsOnStatOnly: false,
        });
      }
      saveLocalCollectionSnapshot(userData, snap);
    }
  } catch (e) {
    console.warn(LOG, "tag snapshot batch flush failed", e);
  }
}

/** After reading tags for the browse UI, refresh snapshot row (stats + tags). */
export async function recordLocalAudioTagsInSnapshot(
  userData: string,
  config: DesktopRuntimeConfig,
  absolutePath: string,
  tags: LocalAudioTagFields,
): Promise<void> {
  const key = path.resolve((absolutePath ?? "").trim());
  if (!key) return;
  try {
    pendingTagSnapshotWrites.set(key, { userData, config, tags });
    if (pendingTagSnapshotWrites.size >= TAG_SNAPSHOT_BATCH_MAX) {
      if (tagSnapshotFlushTimer) {
        clearTimeout(tagSnapshotFlushTimer);
        tagSnapshotFlushTimer = undefined;
      }
      await flushPendingTagSnapshots();
      return;
    }
    if (tagSnapshotFlushTimer) clearTimeout(tagSnapshotFlushTimer);
    tagSnapshotFlushTimer = setTimeout(() => {
      tagSnapshotFlushTimer = undefined;
      void flushPendingTagSnapshots();
    }, TAG_SNAPSHOT_BATCH_MS);
  } catch (e) {
    console.warn(LOG, "tags snapshot enqueue failed", e);
  }
}

/** After a successful one-level list under the music root, record visible audio files (stats only, preserve tags). */
export async function recordListDirAudioFilesInSnapshot(
  userData: string,
  config: DesktopRuntimeConfig,
  files: { path: string }[],
): Promise<void> {
  const rootNorm = normalizeMusicRoot(config.musicFolderPath ?? null);
  if (!rootNorm || files.length === 0) return;

  try {
    const snap = ensureLocalCollectionSnapshot(userData, config);
    for (const f of files) {
      const p = (f.path ?? "").trim();
      if (!p) continue;
      let st;
      try {
        st = await stat(p);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      upsertLocalTrackIntoSnapshot(snap, {
        absolutePath: p,
        musicRootNorm: rootNorm,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
        preserveTagsOnStatOnly: true,
        touchScannedAt: true,
      });
    }
    saveLocalCollectionSnapshot(userData, snap);
  } catch (e) {
    console.warn(LOG, "list dir snapshot failed", e);
  }
}

/**
 * After recursive scan: index files that still lie under the configured music
 * folder root. When `tagsByAbsPath` is provided, real ID3 / metadata tags are
 * written into the snapshot during the scan (so Genre / Artist / Title power
 * AI local search immediately, without needing a follow-up browse or XLSX
 * import). When omitted, only path/size/mtime are recorded.
 */
export async function recordScanAudioFilesInSnapshot(
  userData: string,
  config: DesktopRuntimeConfig,
  absolutePaths: string[],
  tagsByAbsPath?: ReadonlyMap<string, LocalAudioTagFields | null>,
): Promise<void> {
  if (absolutePaths.length === 0) return;
  try {
    const snap = ensureLocalCollectionSnapshot(userData, config);
    const rootNorm = normalizeMusicRoot(config.musicFolderPath ?? null);
    if (!rootNorm) return;

    for (const raw of absolutePaths) {
      const p = (raw ?? "").trim();
      if (!p) continue;
      let st;
      try {
        st = await stat(p);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const incomingTags = tagsByAbsPath?.get(path.resolve(p)) ?? null;
      upsertLocalTrackIntoSnapshot(snap, {
        absolutePath: p,
        musicRootNorm: rootNorm,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
        tags: incomingTags ?? undefined,
        preserveTagsOnStatOnly: !incomingTags,
        touchScannedAt: true,
      });
    }
    saveLocalCollectionSnapshot(userData, snap);
  } catch (e) {
    console.warn(LOG, "scan snapshot failed", e);
  }
}

/**
 * Best-effort flush of debounced tag snapshot writes (e.g. before app quit).
 * Does not throw.
 */
export async function flushLocalCollectionTagSnapshotWrites(): Promise<void> {
  if (tagSnapshotFlushTimer) {
    clearTimeout(tagSnapshotFlushTimer);
    tagSnapshotFlushTimer = undefined;
  }
  await flushPendingTagSnapshots();
}

function scoreSnapshotRow(row: LocalCollectionTrackRecord, query: string): number {
  const intents = parseLocalSearchIntents(query);
  return scoreLocalTrackForAiSearch(
    {
      artist: row.artist,
      title: row.title,
      album: row.album,
      genre: row.genre,
      year: row.year,
      comment: row.comment,
      bpm: row.bpm,
      rating: row.rating,
      trackNumber: row.trackNumber ?? null,
      durationSec: row.durationSec,
      relativePathFromRoot: row.relativePathFromRoot,
      absolutePath: row.absolutePath,
    },
    intents,
  ).score;
}

/**
 * Search in-memory snapshot rows only — no readdir, no stat, no tag reads.
 */
export function searchLocalCollectionSnapshotInMemory(
  snapshot: LocalCollectionSnapshotFile | null,
  query: string,
  limit: number,
): LocalCollectionSearchHit[] {
  if (!snapshot || Object.keys(snapshot.tracks).length === 0) return [];
  const { tokens, phrase } = expandLocalSearchTokens(query);
  if (tokens.length === 0) return [];

  const cap = Math.min(100, Math.max(1, limit));
  const scored: LocalCollectionSearchHit[] = [];

  for (const row of Object.values(snapshot.tracks)) {
    const score = scoreSnapshotRow(row, query);
    if (score <= 0) continue;
    scored.push({
      localId: row.localId,
      absolutePath: row.absolutePath,
      relativePathFromRoot: row.relativePathFromRoot,
      artist: row.artist,
      title: row.title,
      genre: row.genre,
      year: row.year,
      album: row.album,
      durationSec: row.durationSec,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.relativePathFromRoot.localeCompare(b.relativePathFromRoot));
  return scored.slice(0, cap);
}

/**
 * Phase 1 hybrid AI playlist: return richer candidate rows (bpm/comment/rating included)
 * scored against the prompt tokens. Caller (renderer) forwards these to /api/playlists/ai-build
 * as `additionalCandidates`. Snapshot-only; never walks disk.
 */
export function searchLocalForAiPlaylistInMemory(
  snapshot: LocalCollectionSnapshotFile | null,
  query: string,
  limit: number,
): LocalAiPlaylistCandidate[] {
  if (!snapshot || Object.keys(snapshot.tracks).length === 0) return [];
  const intents = parseLocalSearchIntents(query);
  if (intents.groups.length === 0) return [];

  const cap = Math.min(80, Math.max(1, limit));
  const scored: LocalAiPlaylistCandidate[] = [];

  for (const row of Object.values(snapshot.tracks)) {
    const rowFields = {
      artist: row.artist,
      title: row.title,
      album: row.album,
      genre: row.genre,
      year: row.year,
      comment: row.comment,
      bpm: row.bpm,
      rating: row.rating,
      trackNumber: row.trackNumber ?? null,
      durationSec: row.durationSec,
      relativePathFromRoot: row.relativePathFromRoot,
      absolutePath: row.absolutePath,
    };
    const scoredRow = scoreLocalTrackForAiSearch(rowFields, intents);
    if (scoredRow.score <= 0) continue;
    scored.push({
      localId: row.localId,
      absolutePath: row.absolutePath,
      relativePathFromRoot: row.relativePathFromRoot,
      artist: row.artist,
      title: row.title,
      album: row.album,
      genre: row.genre,
      year: row.year,
      comment: row.comment,
      durationSec: row.durationSec,
      bpm: row.bpm,
      rating: row.rating,
      score: scoredRow.score,
      matchDebug: toLocalAiSearchMatchDebug(scoredRow),
    });
  }

  const { results, partialFallback, partialFallbackMessage } = rankLocalAiSearchResults(scored, intents);
  if (partialFallback) {
    console.warn("[SyncBiz:local-snapshot]", partialFallbackMessage, { query: intents.phrase });
  }
  return results.slice(0, cap);
}
