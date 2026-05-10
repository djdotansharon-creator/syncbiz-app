/**
 * Stage 4A — Desktop-only local collection snapshot (metadata + paths, never synced to server).
 *
 * Canonical track id v1 (device-local only, not cross-device identity):
 *   v1:{encodeURIComponent(normalizedRelPath)}:{size}:{mtimeMs}
 * where normalizedRelPath uses forward slashes relative to the configured music folder root.
 * Extend with a v2 prefix if the formula changes — not stable across renames without rescan.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  DesktopRuntimeConfig,
  ListMusicLibraryDirResult,
  LocalAudioTagFields,
} from "../shared/mvp-types";

export const LOCAL_COLLECTION_SCHEMA_VERSION = 1;

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
  };
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
    };
  } catch {
    return null;
  }
}

export function saveLocalCollectionSnapshot(userData: string, snapshot: LocalCollectionSnapshotFile): void {
  const dir = path.dirname(snapshotPath(userData, snapshot.deviceId));
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const toWrite: LocalCollectionSnapshotFile = { ...snapshot, updatedAt: now };
  writeFileSync(snapshotPath(userData, snapshot.deviceId), JSON.stringify(toWrite, null, 2), "utf-8");
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
  const rootChanged = (prevRoot ?? null) !== (rootNorm ?? null);
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
  const durationSec = mergeDuration(tag.durationSec, prev?.durationSec, preserve);

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
    durationSec,
    lastScannedAt,
    lastVerifiedAt: now,
  };

  snapshot.updatedAt = now;
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

async function statAndUpsert(
  userData: string,
  config: DesktopRuntimeConfig,
  absolutePath: string,
  options: { tags?: Partial<LocalAudioTagFields> | null; preserveTagsOnStatOnly?: boolean },
): Promise<void> {
  const rootNorm = normalizeMusicRoot(config.musicFolderPath ?? null);
  if (!rootNorm) return;
  if (!relativeFromMusicRoot(absolutePath, rootNorm)) return;

  let st;
  try {
    st = await stat(absolutePath);
  } catch {
    return;
  }
  if (!st.isFile()) return;

  const snap = ensureLocalCollectionSnapshot(userData, config);
  upsertLocalTrackIntoSnapshot(snap, {
    absolutePath,
    musicRootNorm: rootNorm,
    size: st.size,
    mtimeMs: Math.floor(st.mtimeMs),
    tags: options.tags ?? undefined,
    preserveTagsOnStatOnly: options.preserveTagsOnStatOnly,
  });
  saveLocalCollectionSnapshot(userData, snap);
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

/** After recursive scan: index files that still lie under the configured music folder root. */
export async function recordScanAudioFilesInSnapshot(
  userData: string,
  config: DesktopRuntimeConfig,
  absolutePaths: string[],
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
    console.warn(LOG, "scan snapshot failed", e);
  }
}

/** After reading tags for the browse UI, refresh snapshot row (stats + tags). */
export async function recordLocalAudioTagsInSnapshot(
  userData: string,
  config: DesktopRuntimeConfig,
  absolutePath: string,
  tags: LocalAudioTagFields,
): Promise<void> {
  try {
    await statAndUpsert(userData, config, absolutePath, {
      tags: {
        artist: tags.artist,
        title: tags.title,
        album: tags.album,
        genre: tags.genre,
        year: tags.year,
        durationSec: tags.durationSec,
      },
      preserveTagsOnStatOnly: false,
    });
  } catch (e) {
    console.warn(LOG, "tags snapshot failed", e);
  }
}
