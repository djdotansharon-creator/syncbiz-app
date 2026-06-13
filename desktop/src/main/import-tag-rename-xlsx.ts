/**
 * Import Tag&Rename / PLP-Playlist XLSX exports into the local collection snapshot.
 * User metadata only — never bundled, committed, or uploaded. Match rows by "File Name"
 * (full absolute path) to on-disk MP3 files under the configured music folder.
 */

import { existsSync, readdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { PLAYLISTPRO_METADATA_BANK_ROOT } from "../shared/playlistpro-paths";
import type { DesktopRuntimeConfig, LocalAudioTagFields } from "../shared/mvp-types";
import {
  ensureLocalCollectionSnapshot,
  saveLocalCollectionSnapshot,
  upsertLocalTrackIntoSnapshot,
} from "./local-collection-snapshot";

function normalizeMusicRoot(root: string | null | undefined): string | null {
  const t = (root ?? "").trim();
  if (!t) return null;
  return path.resolve(t);
}

const LOG = "[SyncBiz:import-tag-rename-xlsx]";

/** Fixed PlaylistPro metadata bank root; used as dialog default when present. */
export const TAG_RENAME_XLSX_DEFAULT_DIR = PLAYLISTPRO_METADATA_BANK_ROOT;

export type PickTagRenameXlsxFilesResult =
  | { status: "ok"; filePaths: string[] }
  | { status: "canceled" }
  | { status: "error"; message: string };

export type ImportTagRenameXlsxFilesResult =
  | {
      status: "ok";
      filesProcessed: number;
      rowsRead: number;
      matched: number;
      updated: number;
      unmatched: number;
      outsideMusicFolder: number;
      missingOnDisk: number;
      sampleUnmatchedPaths: string[];
    }
  | { status: "error"; message: string };

function normalizeHeaderKey(raw: string): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, "");
}

/** Map normalized header → field key. "File Name" is the primary path column. */
function headerToField(norm: string): keyof ParsedTagRenameRow | null {
  if (
    norm === "filename" ||
    norm === "filepath" ||
    norm === "fullpath" ||
    norm === "absolutepath" ||
    norm === "path" ||
    norm === "file"
  ) {
    return "fileName";
  }
  if (norm === "artist" || norm === "artists" || norm === "performer") return "artist";
  if (norm === "title" || norm === "track" || norm === "tracktitle" || norm === "name") return "title";
  if (norm === "album") return "album";
  if (norm === "genre" || norm === "genres") return "genre";
  if (norm === "year" || norm === "date" || norm === "releasedate") return "year";
  if (norm === "comment" || norm === "comments" || norm === "description") return "comment";
  if (norm === "bpm" || norm === "tempo") return "bpm";
  if (norm === "rating" || norm === "stars" || norm === "starrating") return "rating";
  if (norm === "tracknumber" || norm === "trackno" || norm === "tracknum" || norm === "track#") {
    return "trackNumber";
  }
  if (
    norm === "duration" ||
    norm === "time" ||
    norm === "length" ||
    norm === "tracktime" ||
    norm === "playtime"
  ) {
    return "durationLabel";
  }
  return null;
}

type ParsedTagRenameRow = {
  fileName: string;
  artist?: string | null;
  title?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: string | null;
  comment?: string | null;
  bpm?: number | null;
  rating?: number | null;
  trackNumber?: string | null;
  /** Raw duration cell (also parsed to durationSec when possible). */
  durationLabel?: string | null;
  durationSec?: number | null | undefined;
};

function coerceCellString(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}

function coerceBpm(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1000) {
    return Math.round(v * 10) / 10;
  }
  const s = coerceCellString(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, "."));
  if (Number.isFinite(n) && n > 0 && n < 1000) return Math.round(n * 10) / 10;
  return null;
}

function coerceDurationSec(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    if (v < 1000) return Math.round(v);
    return null;
  }
  const s = coerceCellString(v);
  if (!s) return null;
  const trimmed = s.trim();
  if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(trimmed)) {
    const parts = trimmed.split(":").map((x) => Number(x));
    if (parts.some((n) => !Number.isFinite(n))) return null;
    if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
    if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  }
  const n = Number(trimmed.replace(/,/g, "."));
  if (Number.isFinite(n) && n > 0 && n < 86400) return Math.round(n);
  return null;
}

function coerceRating(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v >= 0 && v <= 1) return Math.round(v * 5 * 10) / 10;
    if (v > 1 && v <= 5) return Math.round(v * 10) / 10;
    if (v > 5 && v <= 100) return Math.round((v / 20) * 10) / 10;
  }
  const s = coerceCellString(v);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return Math.round(n * 5 * 10) / 10;
  if (n > 1 && n <= 5) return Math.round(n * 10) / 10;
  if (n > 5 && n <= 100) return Math.round((n / 20) * 10) / 10;
  return null;
}

function pathLookupKey(abs: string): string {
  try {
    return path.win32.normalize(path.resolve(abs)).toLowerCase();
  } catch {
    return abs.trim().toLowerCase();
  }
}

function rowToTagFields(row: ParsedTagRenameRow): Partial<LocalAudioTagFields> {
  const commentParts = [row.comment, row.durationLabel, row.trackNumber ? `#${row.trackNumber}` : null].filter(
    Boolean,
  ) as string[];
  const commentMerged =
    commentParts.length > 0 ? [...new Set(commentParts)].join(" · ") : null;
  return {
    artist: row.artist ?? null,
    title: row.title ?? null,
    album: row.album ?? null,
    genre: row.genre ?? null,
    year: row.year ?? null,
    comment: commentMerged,
    bpm: row.bpm ?? null,
    rating: row.rating ?? null,
    durationSec: row.durationSec ?? null,
    trackNumber: row.trackNumber ?? null,
  };
}

function parseSheetRows(
  sheetRows: Record<string, unknown>[],
): { rows: ParsedTagRenameRow[]; rowsRead: number } {
  if (sheetRows.length === 0) return { rows: [], rowsRead: 0 };

  const first = sheetRows[0]!;
  const colMap = new Map<string, keyof ParsedTagRenameRow>();
  for (const key of Object.keys(first)) {
    const field = headerToField(normalizeHeaderKey(key));
    if (field) colMap.set(key, field);
  }

  if (![...colMap.values()].includes("fileName")) {
    for (const key of Object.keys(first)) {
      if (/file\s*name/i.test(key)) {
        colMap.set(key, "fileName");
        break;
      }
    }
  }

  const hasFileName = [...colMap.values()].includes("fileName");
  if (!hasFileName) {
    return { rows: [], rowsRead: 0 };
  }

  const out: ParsedTagRenameRow[] = [];
  for (const raw of sheetRows) {
    const parsed: ParsedTagRenameRow = { fileName: "" };
    for (const [col, field] of colMap) {
      const v = raw[col];
      if (field === "fileName") {
        parsed.fileName = coerceCellString(v) ?? "";
      } else if (field === "bpm") {
        parsed.bpm = coerceBpm(v);
      } else if (field === "rating") {
        parsed.rating = coerceRating(v);
      } else if (field === "durationLabel") {
        parsed.durationLabel = coerceCellString(v);
        parsed.durationSec = coerceDurationSec(v) ?? parsed.durationSec ?? null;
      } else if (field === "trackNumber") {
        parsed.trackNumber = coerceCellString(v);
      } else if (
        field === "artist" ||
        field === "title" ||
        field === "album" ||
        field === "genre" ||
        field === "year" ||
        field === "comment"
      ) {
        parsed[field] = coerceCellString(v);
      }
    }
    if (!parsed.fileName.trim()) continue;
    out.push(parsed);
  }
  return { rows: out, rowsRead: out.length };
}

function loadXlsxModule(): typeof import("xlsx") {
  try {
    return require("xlsx") as typeof import("xlsx");
  } catch {
    throw new Error("Missing dependency `xlsx`. Run: npm install --prefix desktop");
  }
}

/**
 * Read one or more Tag&Rename XLSX files and merge tag fields into the local snapshot.
 */
export async function importTagRenameXlsxFiles(
  userData: string,
  config: DesktopRuntimeConfig,
  filePaths: string[],
): Promise<ImportTagRenameXlsxFilesResult> {
  const paths = filePaths.map((p) => (p ?? "").trim()).filter(Boolean);
  if (paths.length === 0) {
    return { status: "error", message: "No XLSX files selected." };
  }

  const rootNorm = normalizeMusicRoot(config.musicFolderPath ?? null);
  if (!rootNorm) {
    return { status: "error", message: "Choose a music folder before importing Tag&Rename metadata." };
  }

  const XLSX = loadXlsxModule();
  const deviceId = (config.deviceId ?? "").trim() || "unknown";
  const snap = ensureLocalCollectionSnapshot(userData, config);

  let filesProcessed = 0;
  let rowsRead = 0;
  let matched = 0;
  let updated = 0;
  let unmatched = 0;
  let outsideMusicFolder = 0;
  let missingOnDisk = 0;
  const sampleUnmatched: string[] = [];

  for (const filePath of paths) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".xlsx" && ext !== ".xls") continue;
    if (!existsSync(filePath)) {
      console.warn(LOG, "file not found", filePath);
      continue;
    }
    let workbook;
    try {
      workbook = XLSX.readFile(filePath, { cellDates: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { status: "error", message: `Could not read ${path.basename(filePath)}: ${msg}` };
    }
    filesProcessed += 1;
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) continue;
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    const { rows, rowsRead: n } = parseSheetRows(json);
    rowsRead += n;

    for (const row of rows) {
      let abs: string;
      try {
        abs = path.resolve(row.fileName.trim());
      } catch {
        unmatched += 1;
        if (sampleUnmatched.length < 8) sampleUnmatched.push(row.fileName.slice(0, 200));
        continue;
      }

      const rel = path.relative(rootNorm, abs);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        outsideMusicFolder += 1;
        if (sampleUnmatched.length < 8) sampleUnmatched.push(abs);
        continue;
      }

      let st;
      try {
        st = await stat(abs);
      } catch {
        missingOnDisk += 1;
        if (sampleUnmatched.length < 8) sampleUnmatched.push(abs);
        continue;
      }
      if (!st.isFile()) {
        missingOnDisk += 1;
        continue;
      }

      matched += 1;
      const key = pathLookupKey(abs);
      const hadRow = Object.values(snap.tracks).some((r) => pathLookupKey(r.absolutePath) === key);
      upsertLocalTrackIntoSnapshot(snap, {
        absolutePath: abs,
        musicRootNorm: rootNorm,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
        tags: rowToTagFields(row),
        touchScannedAt: !hadRow,
      });
      updated += 1;
    }
  }

  saveLocalCollectionSnapshot(userData, snap);

  console.info(LOG, "import complete", {
    filesProcessed,
    rowsRead,
    matched,
    updated,
    outsideMusicFolder,
    missingOnDisk,
  });

  return {
    status: "ok",
    filesProcessed,
    rowsRead,
    matched,
    updated,
    unmatched,
    outsideMusicFolder,
    missingOnDisk,
    sampleUnmatchedPaths: sampleUnmatched,
  };
}

/** Recursively list .xlsx / .xls under a metadata bank folder (sorted). */
export function listTagRenameXlsxFilesInFolder(rootDir: string): string[] {
  const root = path.resolve(rootDir.trim());
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && /\.(xlsx|xls)$/i.test(ent.name)) out.push(full);
    }
  };
  walk(root);
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Default directory for the native open dialog when the recommended path exists. */
export function defaultTagRenameXlsxPickerPath(): string | undefined {
  if (existsSync(TAG_RENAME_XLSX_DEFAULT_DIR)) return TAG_RENAME_XLSX_DEFAULT_DIR;
  const repoDev = path.resolve(process.cwd(), ".local-imports", "PLP-Playlist");
  if (existsSync(repoDev)) return repoDev;
  return undefined;
}
