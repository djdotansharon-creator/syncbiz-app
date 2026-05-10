/**
 * Stage 5B — Parse local M3U/M3U8/PLS as static path lists; resolve under Music Folder only.
 */

import { readFileSync, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopRuntimeConfig, ImportLocalM3uPlaylistResult, ImportLocalM3uUnresolvedEntry } from "../shared/mvp-types";
import { recordScanAudioFilesInSnapshot } from "./local-collection-snapshot";

const LOG = "[SyncBiz:import-playlist-file]";

/** Match desktop `scan-local-audio-folder` (V1). */
const AUDIO_EXTS = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]);

function normalizeMusicRoot(root: string | null | undefined): string | null {
  const t = (root ?? "").trim();
  if (!t) return null;
  return path.resolve(t);
}

function isUnderMusicRoot(abs: string, rootNorm: string): boolean {
  const rel = path.relative(rootNorm, path.resolve(abs));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return true;
}

function pathKey(abs: string): string {
  const r = path.resolve(abs);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

/**
 * Split playlist text into lines. `\r` alone (old Mac / some exporters) must split —
 * `String.split(/\r?\n/)` leaves the whole file as one line and only the first path is imported.
 */
function splitPlaylistLines(text: string): string[] {
  const n = text.replace(/\0/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return n.split("\n");
}

function displayNameFromAbsolute(abs: string): string {
  const base = path.basename(abs);
  const noExt = base.replace(/\.[^.]+$/, "");
  return (noExt || base || "Track").trim() || "Track";
}

function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

function resolvePathLine(raw: string, playlistDir: string): { kind: "absolute"; absolute: string } | { kind: "remote" } | { kind: "bad" } {
  const t = raw.trim();
  if (!t) return { kind: "bad" };
  if (/^https?:\/\//i.test(t)) return { kind: "remote" };
  if (t.toLowerCase().startsWith("file:")) {
    try {
      const abs = path.resolve(fileURLToPath(t));
      return { kind: "absolute", absolute: abs };
    } catch {
      return { kind: "bad" };
    }
  }
  const abs = path.isAbsolute(t) ? path.resolve(t) : path.resolve(playlistDir, t);
  return { kind: "absolute", absolute: abs };
}

/** Title after first comma (per M3U EXTINF); duration may be absent in some files. */
function parseExtInfTitle(line: string): string | null {
  const trimmed = line.trim();
  if (!/^#EXTINF:/i.test(trimmed)) return null;
  const body = trimmed.slice("#EXTINF:".length).trim();
  const comma = body.indexOf(",");
  if (comma === -1) return null;
  const title = body.slice(comma + 1).trim();
  return title.length > 0 ? title : null;
}

function playlistTitleFromPath(playlistPath: string): string {
  const base = path.basename(playlistPath.replace(/[\\/]+$/, ""));
  return base.replace(/\.[^.]+$/i, "") || base || "Imported playlist";
}

type PathParseState = {
  resolvedFiles: string[];
  trackDisplayNames: string[];
  unresolved: ImportLocalM3uUnresolvedEntry[];
  skipped: number;
  seenKeys: Set<string>;
};

async function tryAddAudioFromPathLine(
  state: PathParseState,
  rawRef: string,
  pathLine: string,
  playlistDir: string,
  rootNorm: string,
  pendingTitle: string | null,
): Promise<void> {
  const trimmed = pathLine.trim();
  const refForMsg = rawRef.slice(0, 400);

  if (!trimmed) {
    state.unresolved.push({ ref: refForMsg, reason: "invalid_path" });
    return;
  }

  const resolvedPath = resolvePathLine(trimmed, playlistDir);
  if (resolvedPath.kind === "remote") {
    state.unresolved.push({ ref: refForMsg, reason: "remote_url" });
    return;
  }
  if (resolvedPath.kind === "bad") {
    state.unresolved.push({ ref: refForMsg, reason: "invalid_path" });
    return;
  }

  const abs = resolvedPath.absolute;

  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(abs);
  } catch {
    state.unresolved.push({ ref: refForMsg, reason: "missing" });
    return;
  }

  if (!st.isFile()) {
    state.unresolved.push({ ref: refForMsg, reason: "missing" });
    return;
  }

  if (!AUDIO_EXTS.has(extOf(abs))) {
    state.unresolved.push({ ref: refForMsg, reason: "not_audio" });
    return;
  }

  if (!isUnderMusicRoot(abs, rootNorm)) {
    state.unresolved.push({ ref: refForMsg, reason: "outside_root" });
    return;
  }

  const k = pathKey(abs);
  if (state.seenKeys.has(k)) {
    state.skipped += 1;
    return;
  }
  state.seenKeys.add(k);

  state.resolvedFiles.push(abs);
  const name =
    (pendingTitle && pendingTitle.trim()) ||
    displayNameFromAbsolute(abs);
  state.trackDisplayNames.push(name);
}

function parsePlsFileEntries(text: string): Array<{ rawRef: string; pathLine: string; title: string | null }> {
  const lines = splitPlaylistLines(text);
  const files = new Map<number, string>();
  const titles = new Map<number, string>();
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const fileM = t.match(/^File\s*(\d+)\s*=\s*(.+)$/i);
    if (fileM) {
      files.set(parseInt(fileM[1], 10), fileM[2].trim());
      continue;
    }
    const titleM = t.match(/^Title\s*(\d+)\s*=\s*(.+)$/i);
    if (titleM) {
      titles.set(parseInt(titleM[1], 10), titleM[2].trim());
    }
  }
  const indices = [...files.keys()].sort((a, b) => a - b);
  return indices.map((i) => ({
    rawRef: `File${i}=${files.get(i)!.slice(0, 200)}`,
    pathLine: files.get(i)!,
    title: titles.get(i) ?? null,
  }));
}

function parsePlsPlaylistName(text: string): string | null {
  const lines = splitPlaylistLines(text);
  for (const line of lines) {
    const m = line.trim().match(/^PlaylistName\s*=\s*(.+)$/i);
    if (m) {
      const n = (m[1] ?? "").trim();
      return n || null;
    }
  }
  return null;
}

async function importM3uLikeContent(
  text: string,
  playlistFileAbs: string,
  rootNorm: string,
): Promise<{
  playlistName: string;
  files: string[];
  trackDisplayNames: string[];
  imported: number;
  unresolved: ImportLocalM3uUnresolvedEntry[];
  skipped: number;
}> {
  const playlistDir = path.dirname(path.resolve(playlistFileAbs));
  const lines = splitPlaylistLines(text);

  let explicitPlaylistName: string | null = null;
  let pendingTitle: string | null = null;

  const state: PathParseState = {
    resolvedFiles: [],
    trackDisplayNames: [],
    unresolved: [],
    skipped: 0,
    seenKeys: new Set(),
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const pl = trimmed.match(/^#PLAYLIST:\s*(.+)$/i);
    if (pl) {
      const n = (pl[1] ?? "").trim();
      if (n) explicitPlaylistName = n;
      continue;
    }

    if (/^#EXTINF/i.test(trimmed)) {
      pendingTitle = parseExtInfTitle(trimmed);
      continue;
    }

    if (trimmed.startsWith("#")) continue;

    const titleForRow = pendingTitle;
    pendingTitle = null;
    await tryAddAudioFromPathLine(state, trimmed, trimmed, playlistDir, rootNorm, titleForRow);
  }

  const playlistName =
    (explicitPlaylistName && explicitPlaylistName.trim()) ||
    playlistTitleFromPath(playlistFileAbs);

  return {
    playlistName,
    files: state.resolvedFiles,
    trackDisplayNames: state.trackDisplayNames,
    imported: state.resolvedFiles.length,
    unresolved: state.unresolved,
    skipped: state.skipped,
  };
}

async function importPlsContent(
  text: string,
  playlistFileAbs: string,
  rootNorm: string,
): Promise<{
  playlistName: string;
  files: string[];
  trackDisplayNames: string[];
  imported: number;
  unresolved: ImportLocalM3uUnresolvedEntry[];
  skipped: number;
}> {
  const playlistDir = path.dirname(path.resolve(playlistFileAbs));
  const entries = parsePlsFileEntries(text);
  const state: PathParseState = {
    resolvedFiles: [],
    trackDisplayNames: [],
    unresolved: [],
    skipped: 0,
    seenKeys: new Set(),
  };

  for (const e of entries) {
    await tryAddAudioFromPathLine(state, e.rawRef, e.pathLine, playlistDir, rootNorm, e.title);
  }

  const fromMeta = parsePlsPlaylistName(text);
  const playlistName = (fromMeta && fromMeta.trim()) || playlistTitleFromPath(playlistFileAbs);

  return {
    playlistName,
    files: state.resolvedFiles,
    trackDisplayNames: state.trackDisplayNames,
    imported: state.resolvedFiles.length,
    unresolved: state.unresolved,
    skipped: state.skipped,
  };
}

/**
 * Read and resolve M3U, M3U8, or PLS. Only audio files under `config.musicFolderPath` are returned.
 */
export async function importLocalM3uPlaylist(
  userData: string,
  config: DesktopRuntimeConfig,
  playlistAbsolutePath: string,
): Promise<ImportLocalM3uPlaylistResult> {
  const rootNorm = normalizeMusicRoot(config.musicFolderPath ?? null);
  if (!rootNorm) {
    return { status: "error", message: "Music folder is not configured. Choose a folder in Settings first." };
  }

  const fileRaw = (playlistAbsolutePath ?? "").trim();
  if (!fileRaw) {
    return { status: "error", message: "Empty playlist path." };
  }

  const ext = extOf(fileRaw);
  if (ext !== ".m3u" && ext !== ".m3u8" && ext !== ".pls") {
    return { status: "error", message: "File must be .m3u, .m3u8, or .pls." };
  }

  if (!existsSync(fileRaw)) {
    return { status: "error", message: "Playlist file not found." };
  }

  let fileStat;
  try {
    fileStat = await stat(fileRaw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "error", message: `Could not read playlist: ${msg}` };
  }
  if (!fileStat.isFile()) {
    return { status: "error", message: "Path is not a file." };
  }

  let text: string;
  try {
    text = stripBom(readFileSync(fileRaw, "utf8"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "error", message: `Could not read playlist: ${msg}` };
  }

  const payload =
    ext === ".pls"
      ? await importPlsContent(text, fileRaw, rootNorm)
      : await importM3uLikeContent(text, fileRaw, rootNorm);

  if (payload.files.length > 0) {
    try {
      await recordScanAudioFilesInSnapshot(userData, config, payload.files);
    } catch (e) {
      console.warn(LOG, "snapshot update failed (playlist still created in UI)", e);
    }
  }

  return {
    status: "ok",
    ...payload,
  };
}
