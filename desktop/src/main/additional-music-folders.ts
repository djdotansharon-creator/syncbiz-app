/**
 * Additional Music Folders (Pilot — Winamp Watch Folders model).
 *
 * Normal users add/remove/scan extra music folders here. PlaylistPro is a
 * SEPARATE, protected source (see `playlistpro-config.ts`) and is intentionally
 * excluded from this module: callers attempting to add a path under the
 * PlaylistPro root get a `protected` rejection.
 *
 * Snapshot integration: scans walk audio files under each root via
 * `scanLocalAudioFolder`, then upsert rows into the shared
 * `LocalCollectionSnapshotFile`. We re-use the same v1 canonical id format
 * (relative path + size + mtime) but key the relative path off the per-folder
 * root, so two folders can host files with identical relative paths without
 * collision (root path is part of `absolutePath` which keeps the row unique
 * within the snapshot's tracks map).
 */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  AddAdditionalMusicFolderResult,
  DesktopRuntimeConfig,
  LocalAudioTagFields,
  MusicLibrarySource,
  MusicLibrarySourcesResult,
  RemoveAdditionalMusicFolderResult,
  ScanMusicLibraryResult,
  ScanMusicLibrarySummary,
} from "../shared/mvp-types";
import { PLAYLISTPRO_MUSIC_ROOT, isPlaylistProMusicRoot } from "../shared/playlistpro-paths";
import { patchRuntimeConfig } from "./runtime-config-service";
import {
  ensureLocalCollectionSnapshot,
  loadLocalCollectionSnapshot,
  recordExtraRootScanInSnapshot,
  recordScanAudioFilesInSnapshot,
  saveLocalCollectionSnapshot,
  setSnapshotLastScanForRoot,
} from "./local-collection-snapshot";
import { scanLocalAudioFolder } from "./scan-local-audio-folder";
import { extractLocalAudioTagFields } from "./extract-local-audio-tags";

const LOG = "[SyncBiz:additional-folders]";

/**
 * Pilot Blocker (Local Jazz strictness) — scan-time ID3 tag concurrency.
 * The Electron main process reads tags via music-metadata; 4-way concurrency
 * keeps an SSD-backed 8 000-file library at ~20–40 seconds while avoiding
 * the disk-thrash and ~2x-3x latency we observed at concurrency 16+.
 */
const TAG_READ_CONCURRENCY = 4;

/**
 * Walk an absolute path list with bounded concurrency, calling music-metadata
 * for each file. Returns a Map keyed by canonical absolute path so the snapshot
 * upsert can attach the correct row. Failed reads are stored as `null` (the
 * snapshot upsert preserves prior tags in that case via `preserveTagsOnStatOnly`).
 */
async function readTagsForScannedFilesWithConcurrency(
  absolutePaths: string[],
): Promise<Map<string, LocalAudioTagFields | null>> {
  const out = new Map<string, LocalAudioTagFields | null>();
  if (absolutePaths.length === 0) return out;
  const queue = absolutePaths.slice();
  const workerCount = Math.min(TAG_READ_CONCURRENCY, queue.length);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          try {
            const tags = await extractLocalAudioTagFields(next);
            out.set(path.resolve(next), tags);
          } catch (e) {
            console.warn(LOG, "tag read failed (kept path-only)", { path: next.slice(-120), err: String(e) });
            out.set(path.resolve(next), null);
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
  return out;
}

function normalizeWinPathForCompare(p: string): string {
  return path.resolve(p).toLowerCase();
}

function safeStableId(rootPath: string, kind: "playlistpro" | "additional"): string {
  const h = createHash("sha1").update(`${kind}:${path.resolve(rootPath)}`).digest("hex").slice(0, 10);
  return `${kind}-${h}`;
}

function defaultDisplayLabelForPath(rootPath: string): string {
  const trimmed = rootPath.replace(/[\\/]+$/, "");
  const name = path.basename(trimmed);
  return name || rootPath;
}

function isAlreadyKnown(
  rootPath: string,
  config: DesktopRuntimeConfig,
): "playlistpro_root" | "duplicate" | null {
  const cmp = normalizeWinPathForCompare(rootPath);
  if (isPlaylistProMusicRoot(rootPath)) return "playlistpro_root";
  if (config.musicFolderPath?.trim() && normalizeWinPathForCompare(config.musicFolderPath) === cmp) {
    // Already covered by PlaylistPro / primary music folder.
    return "playlistpro_root";
  }
  const list = Array.isArray(config.additionalMusicFolders) ? config.additionalMusicFolders : [];
  for (const existing of list) {
    if (normalizeWinPathForCompare(existing) === cmp) return "duplicate";
  }
  return null;
}

/**
 * Build the protected PlaylistPro source descriptor. Status is `unconfigured`
 * when no path is set, `missing` when configured but absent on disk, and
 * `ready` when present.
 */
function buildPlaylistProSource(
  userData: string,
  config: DesktopRuntimeConfig,
): MusicLibrarySource {
  const configured = (config.musicFolderPath ?? "").trim();
  const effective = configured || PLAYLISTPRO_MUSIC_ROOT;
  const id = safeStableId(effective || PLAYLISTPRO_MUSIC_ROOT, "playlistpro");
  let status: MusicLibrarySource["status"] = "unconfigured";
  if (!effective) status = "unconfigured";
  else if (existsSync(effective)) status = "ready";
  else status = "missing";

  // Snapshot stats — main snapshot is keyed off the primary music folder root.
  let trackCount: number | null = null;
  let lastScanIso: string | null = null;
  try {
    const deviceId = (config.deviceId ?? "").trim() || "unknown";
    const snap = loadLocalCollectionSnapshot(userData, deviceId);
    if (snap) {
      const root = effective ? path.resolve(effective).toLowerCase() : "";
      let count = 0;
      let latest: string | null = null;
      for (const row of Object.values(snap.tracks)) {
        const rowRoot = (row.rootPath ?? snap.musicFolderRoot ?? "").trim();
        if (!rowRoot) continue;
        if (path.resolve(rowRoot).toLowerCase() !== root) continue;
        count += 1;
        if (!latest || (row.lastScannedAt && row.lastScannedAt > latest)) {
          latest = row.lastScannedAt;
        }
      }
      trackCount = count;
      lastScanIso = latest ?? snap.updatedAt ?? null;
      const rootScan = (snap.rootScanTimestamps ?? {})[root];
      if (rootScan && (!lastScanIso || rootScan > lastScanIso)) lastScanIso = rootScan;
    }
  } catch {
    // ignore snapshot read errors — UI still renders status from disk.
  }

  return {
    id,
    kind: "playlistpro",
    path: effective,
    displayLabel: "PlaylistPro Library",
    status,
    trackCount,
    lastScanIso,
    removable: false,
  };
}

function buildAdditionalSource(
  userData: string,
  config: DesktopRuntimeConfig,
  rootPath: string,
): MusicLibrarySource {
  const id = safeStableId(rootPath, "additional");
  const exists = existsSync(rootPath);
  let trackCount: number | null = null;
  let lastScanIso: string | null = null;
  try {
    const deviceId = (config.deviceId ?? "").trim() || "unknown";
    const snap = loadLocalCollectionSnapshot(userData, deviceId);
    if (snap) {
      const root = path.resolve(rootPath).toLowerCase();
      let count = 0;
      let latest: string | null = null;
      for (const row of Object.values(snap.tracks)) {
        const rowRoot = (row.rootPath ?? snap.musicFolderRoot ?? "").trim();
        if (!rowRoot) continue;
        if (path.resolve(rowRoot).toLowerCase() !== root) continue;
        count += 1;
        if (!latest || (row.lastScannedAt && row.lastScannedAt > latest)) {
          latest = row.lastScannedAt;
        }
      }
      trackCount = count;
      lastScanIso = latest;
      const rootScan = (snap.rootScanTimestamps ?? {})[root];
      if (rootScan && (!lastScanIso || rootScan > lastScanIso)) lastScanIso = rootScan;
    }
  } catch {
    // ignore
  }
  return {
    id,
    kind: "additional",
    path: rootPath,
    displayLabel: defaultDisplayLabelForPath(rootPath),
    status: exists ? "ready" : "missing",
    trackCount,
    lastScanIso,
    removable: true,
  };
}

export function listMusicLibrarySources(
  userData: string,
  config: DesktopRuntimeConfig,
): MusicLibrarySourcesResult {
  const playlistPro = buildPlaylistProSource(userData, config);
  const list = Array.isArray(config.additionalMusicFolders) ? config.additionalMusicFolders : [];
  const additional = list.map((p) => buildAdditionalSource(userData, config, p));
  return { playlistPro, additional };
}

export function addAdditionalMusicFolder(
  userData: string,
  config: DesktopRuntimeConfig,
  rawPath: string,
): { result: AddAdditionalMusicFolderResult; config: DesktopRuntimeConfig } {
  const trimmed = (rawPath ?? "").trim();
  if (!trimmed) {
    return { result: { status: "error", message: "Empty path" }, config };
  }
  const known = isAlreadyKnown(trimmed, config);
  if (known === "playlistpro_root") {
    return { result: { status: "protected", reason: "playlistpro_root" }, config };
  }
  if (known === "duplicate") {
    return { result: { status: "already_added", path: trimmed }, config };
  }
  const list = Array.isArray(config.additionalMusicFolders) ? config.additionalMusicFolders : [];
  const next = [...list, trimmed];
  const patched = patchRuntimeConfig(userData, config, { additionalMusicFolders: next });
  const source = buildAdditionalSource(userData, patched, trimmed);
  return { result: { status: "ok", source }, config: patched };
}

export function removeAdditionalMusicFolder(
  userData: string,
  config: DesktopRuntimeConfig,
  rawPath: string,
): { result: RemoveAdditionalMusicFolderResult; config: DesktopRuntimeConfig } {
  const trimmed = (rawPath ?? "").trim();
  if (!trimmed) {
    return { result: { status: "error", message: "Empty path" }, config };
  }
  if (isPlaylistProMusicRoot(trimmed)) {
    return { result: { status: "protected", reason: "playlistpro_root" }, config };
  }
  const list = Array.isArray(config.additionalMusicFolders) ? config.additionalMusicFolders : [];
  const cmp = normalizeWinPathForCompare(trimmed);
  const next = list.filter((p) => normalizeWinPathForCompare(p) !== cmp);
  if (next.length === list.length) {
    return { result: { status: "not_found" }, config };
  }
  const patched = patchRuntimeConfig(userData, config, { additionalMusicFolders: next });
  return { result: { status: "ok" }, config: patched };
}

/**
 * Walk audio files under PlaylistPro + each additional folder and refresh the
 * shared local collection snapshot. Returns per-source summary so the UI can
 * surface per-folder errors (missing folder, read failures).
 */
export async function scanMusicLibrary(
  userData: string,
  config: DesktopRuntimeConfig,
): Promise<ScanMusicLibraryResult> {
  const sources = listMusicLibrarySources(userData, config);
  const summaries: ScanMusicLibrarySummary[] = [];

  try {
    const ensured = ensureLocalCollectionSnapshot(userData, config);
    setSnapshotLastScanForRoot(ensured, sources.playlistPro.path, new Date().toISOString());
    saveLocalCollectionSnapshot(userData, ensured);
  } catch {
    // best effort — scan continues
  }

  // 1) PlaylistPro / primary music folder (existing snapshot path)
  if (sources.playlistPro.path && sources.playlistPro.status === "ready") {
    let st: Awaited<ReturnType<typeof stat>> | null = null;
    try {
      st = await stat(sources.playlistPro.path);
    } catch {
      st = null;
    }
    if (st && st.isDirectory()) {
      const res = await scanLocalAudioFolder(sources.playlistPro.path);
      if (res.status === "ok") {
        const tagsByAbsPath = await readTagsForScannedFilesWithConcurrency(res.files);
        await recordScanAudioFilesInSnapshot(userData, config, res.files, tagsByAbsPath);
        summaries.push({
          path: sources.playlistPro.path,
          kind: "playlistpro",
          filesIndexed: res.files.length,
          errorMessage: null,
        });
      } else if (res.status === "not_directory") {
        summaries.push({
          path: sources.playlistPro.path,
          kind: "playlistpro",
          filesIndexed: 0,
          errorMessage: "Path is not a directory.",
        });
      } else {
        summaries.push({
          path: sources.playlistPro.path,
          kind: "playlistpro",
          filesIndexed: 0,
          errorMessage: res.message,
        });
      }
    } else {
      summaries.push({
        path: sources.playlistPro.path,
        kind: "playlistpro",
        filesIndexed: 0,
        errorMessage: "Folder not available on disk.",
      });
    }
  } else if (sources.playlistPro.path) {
    summaries.push({
      path: sources.playlistPro.path,
      kind: "playlistpro",
      filesIndexed: 0,
      errorMessage:
        sources.playlistPro.status === "missing"
          ? "Folder not available on disk."
          : "Folder not configured.",
    });
  }

  // 2) Additional folders (multi-root snapshot path)
  for (const extra of sources.additional) {
    if (extra.status !== "ready") {
      summaries.push({
        path: extra.path,
        kind: "additional",
        filesIndexed: 0,
        errorMessage: "Folder not available on disk.",
      });
      continue;
    }
    const res = await scanLocalAudioFolder(extra.path);
    if (res.status === "ok") {
      try {
        const tagsByAbsPath = await readTagsForScannedFilesWithConcurrency(res.files);
        await recordExtraRootScanInSnapshot(userData, config, extra.path, res.files, tagsByAbsPath);
        summaries.push({
          path: extra.path,
          kind: "additional",
          filesIndexed: res.files.length,
          errorMessage: null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summaries.push({
          path: extra.path,
          kind: "additional",
          filesIndexed: 0,
          errorMessage: msg,
        });
      }
    } else if (res.status === "not_directory") {
      summaries.push({
        path: extra.path,
        kind: "additional",
        filesIndexed: 0,
        errorMessage: "Path is not a directory.",
      });
    } else {
      summaries.push({
        path: extra.path,
        kind: "additional",
        filesIndexed: 0,
        errorMessage: res.message,
      });
    }
  }

  console.info(LOG, "scan finished", summaries);

  return {
    status: "ok",
    scannedAtIso: new Date().toISOString(),
    sources: summaries,
  };
}
