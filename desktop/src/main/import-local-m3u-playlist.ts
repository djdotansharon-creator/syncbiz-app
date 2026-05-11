/**
 * Stage 5B — Parse local M3U/M3U8/PLS as static path lists; resolve under Music Folder only.
 */

import { readFileSync, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DesktopRuntimeConfig,
  ImportLocalM3uPlaylistResult,
  ImportLocalM3uUnresolvedEntry,
  ImportLocalM3uUnresolvedReason,
} from "../shared/mvp-types";
import { recordScanAudioFilesInSnapshot } from "./local-collection-snapshot";

const LOG = "[SyncBiz:import-playlist-file]";
const UNRESOLVED_REF_CAP = 2000;

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

/** Parse `#EXTINF:duration,title` (duration may be `-1` / `0` for unknown). */
function parseExtInfLine(line: string): { title: string | null; durationSec: number | null } {
  const trimmed = line.trim();
  if (!/^#EXTINF:/i.test(trimmed)) return { title: null, durationSec: null };
  const body = trimmed.slice("#EXTINF:".length).trim();
  const comma = body.indexOf(",");
  if (comma === -1) {
    return { title: null, durationSec: parseExtInfDurationSegment(body) };
  }
  const durRaw = body.slice(0, comma).trim();
  const titlePart = body.slice(comma + 1).trim();
  return {
    durationSec: parseExtInfDurationSegment(durRaw),
    title: titlePart.length > 0 ? titlePart : null,
  };
}

/** M3U: positive integer seconds only; `-1` / `0` / blank → unknown (`null`). */
function parseExtInfDurationSegment(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function displayNameFromPathHint(p: string): string {
  const base = path.basename(p.trim());
  const noExt = base.replace(/\.[^.]+$/, "");
  return (noExt || base || "Track").trim() || "Track";
}

function buildSuggestedSearchQuery(
  displayTitle: string | null,
  pathHint: string | null,
  refFallback: string,
): string {
  const dt = displayTitle?.trim();
  if (dt) return dt;
  const raw = (pathHint ?? "").trim() || refFallback.trim();
  if (!raw) return "Track";
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const last = u.pathname.split("/").filter(Boolean).pop();
      if (last && last.length > 2) return decodeURIComponent(last.replace(/\.[^.]+$/, ""));
    } catch {
      /* ignore */
    }
    return raw.slice(0, 200);
  }
  return displayNameFromPathHint(raw);
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
  /** Next 0-based playlist position for each file/URL row; incremented at start of each try. */
  nextPlaylistOrder: number;
};

function pushUnresolved(
  state: PathParseState,
  opts: {
    rawRef: string;
    trimmedPathLine: string;
    reason: ImportLocalM3uUnresolvedReason;
    playlistOrder: number;
    displayTitle: string | null;
    durationSec: number | null;
    pathHintForSearch: string | null;
  },
): void {
  const combined = opts.trimmedPathLine.trim() || opts.rawRef.trim();
  const ref = combined.slice(0, UNRESOLVED_REF_CAP);
  const normalizedTitle =
    opts.displayTitle && opts.displayTitle.trim().length > 0 ? opts.displayTitle.trim() : null;
  state.unresolved.push({
    ref,
    reason: opts.reason,
    playlistOrder: opts.playlistOrder,
    displayTitle: normalizedTitle,
    durationSec: opts.durationSec,
    suggestedSearchQuery: buildSuggestedSearchQuery(normalizedTitle, opts.pathHintForSearch, ref),
  });
}

/** PLS `LengthN` — positive integer seconds; `0`/`-1`/invalid → unknown. */
function parsePlsLengthSeconds(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function tryAddAudioFromPathLine(
  state: PathParseState,
  rawRef: string,
  pathLine: string,
  playlistDir: string,
  rootNorm: string,
  pendingTitle: string | null,
  pendingDurationSec: number | null,
): Promise<void> {
  const playlistOrder = state.nextPlaylistOrder++;

  const trimmed = pathLine.trim();

  if (!trimmed) {
    pushUnresolved(state, {
      rawRef,
      trimmedPathLine: trimmed,
      reason: "invalid_path",
      playlistOrder,
      displayTitle: pendingTitle,
      durationSec: pendingDurationSec,
      pathHintForSearch: null,
    });
    return;
  }

  const resolvedPath = resolvePathLine(trimmed, playlistDir);
  if (resolvedPath.kind === "remote") {
    pushUnresolved(state, {
      rawRef,
      trimmedPathLine: trimmed,
      reason: "remote_url",
      playlistOrder,
      displayTitle: pendingTitle,
      durationSec: pendingDurationSec,
      pathHintForSearch: trimmed,
    });
    return;
  }
  if (resolvedPath.kind === "bad") {
    pushUnresolved(state, {
      rawRef,
      trimmedPathLine: trimmed,
      reason: "invalid_path",
      playlistOrder,
      displayTitle: pendingTitle,
      durationSec: pendingDurationSec,
      pathHintForSearch: null,
    });
    return;
  }

  const abs = resolvedPath.absolute;

  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(abs);
  } catch {
    pushUnresolved(state, {
      rawRef,
      trimmedPathLine: trimmed,
      reason: "missing",
      playlistOrder,
      displayTitle: pendingTitle,
      durationSec: pendingDurationSec,
      pathHintForSearch: abs,
    });
    return;
  }

  if (!st.isFile()) {
    pushUnresolved(state, {
      rawRef,
      trimmedPathLine: trimmed,
      reason: "missing",
      playlistOrder,
      displayTitle: pendingTitle,
      durationSec: pendingDurationSec,
      pathHintForSearch: abs,
    });
    return;
  }

  if (!AUDIO_EXTS.has(extOf(abs))) {
    pushUnresolved(state, {
      rawRef,
      trimmedPathLine: trimmed,
      reason: "not_audio",
      playlistOrder,
      displayTitle: pendingTitle,
      durationSec: pendingDurationSec,
      pathHintForSearch: abs,
    });
    return;
  }

  if (!isUnderMusicRoot(abs, rootNorm)) {
    pushUnresolved(state, {
      rawRef,
      trimmedPathLine: trimmed,
      reason: "outside_root",
      playlistOrder,
      displayTitle: pendingTitle,
      durationSec: pendingDurationSec,
      pathHintForSearch: abs,
    });
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

function parsePlsFileEntries(
  text: string,
): Array<{ rawRef: string; pathLine: string; title: string | null; lengthSec: number | null }> {
  const lines = splitPlaylistLines(text);
  const files = new Map<number, string>();
  const titles = new Map<number, string>();
  const lengths = new Map<number, string>();
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
      continue;
    }
    const lenM = t.match(/^Length\s*(\d+)\s*=\s*(.+)$/i);
    if (lenM) {
      lengths.set(parseInt(lenM[1], 10), lenM[2].trim());
    }
  }
  const indices = [...files.keys()].sort((a, b) => a - b);
  return indices.map((i) => ({
    rawRef: `File${i}=${files.get(i)!.slice(0, 200)}`,
    pathLine: files.get(i)!,
    title: titles.get(i) ?? null,
    lengthSec: parsePlsLengthSeconds(lengths.get(i)),
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
  let pendingDurationSec: number | null = null;

  const state: PathParseState = {
    resolvedFiles: [],
    trackDisplayNames: [],
    unresolved: [],
    skipped: 0,
    seenKeys: new Set(),
    nextPlaylistOrder: 0,
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
      const ext = parseExtInfLine(trimmed);
      pendingTitle = ext.title;
      pendingDurationSec = ext.durationSec;
      continue;
    }

    if (trimmed.startsWith("#")) continue;

    const titleForRow = pendingTitle;
    const durationForRow = pendingDurationSec;
    pendingTitle = null;
    pendingDurationSec = null;
    await tryAddAudioFromPathLine(
      state,
      trimmed,
      trimmed,
      playlistDir,
      rootNorm,
      titleForRow,
      durationForRow,
    );
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
    nextPlaylistOrder: 0,
  };

  for (const e of entries) {
    await tryAddAudioFromPathLine(
      state,
      e.rawRef,
      e.pathLine,
      playlistDir,
      rootNorm,
      e.title,
      e.lengthSec,
    );
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
