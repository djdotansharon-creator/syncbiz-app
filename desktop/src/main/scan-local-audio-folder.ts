/**
 * List supported audio files in a directory (SyncBiz Player main process only).
 * No network; paths returned as absolute for MPV.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ScanLocalAudioFolderResult } from "../shared/mvp-types";

const LOG = "[SyncBiz:desktop:scan-local-folder]";

const AUDIO_EXTS = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]);
/** Safety limits for very large trees */
const MAX_DEPTH = 64;
const MAX_FILES = 8_000;

async function walkAudioFiles(dir: string, out: string[], depth: number): Promise<void> {
  if (depth > MAX_DEPTH) {
    console.warn(LOG, "max depth reached, skipping below", dir);
    return;
  }
  if (out.length >= MAX_FILES) return;
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(LOG, "skipping unreadable dir", dir, msg);
    return;
  }
  for (const d of dirents) {
    if (out.length >= MAX_FILES) break;
    const name = d.name as string;
    const full = path.join(dir, name);
    if (d.isDirectory()) {
      await walkAudioFiles(full, out, depth + 1);
    } else if (d.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (AUDIO_EXTS.has(ext)) out.push(full);
    }
  }
}

export async function scanLocalAudioFolder(rawPath: string): Promise<ScanLocalAudioFolderResult> {
  const p = path.normalize((rawPath ?? "").trim());
  if (!p) {
    return { status: "error", message: "Empty path" };
  }
  try {
    const st = await stat(p);
    if (st.isFile()) {
      return { status: "not_directory" };
    }
    if (!st.isDirectory()) {
      return { status: "error", message: "Path is not a file or directory" };
    }
    const out: string[] = [];
    await walkAudioFiles(p, out, 0);
    if (out.length >= MAX_FILES) {
      console.warn(LOG, "hit file cap, playlist truncated", { dir: p, cap: MAX_FILES });
    }
    out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    if (out.length === 0) {
      console.warn(LOG, "no supported audio in tree", p);
      return {
        status: "error",
        message: "No supported audio files in folder (.mp3, .wav, .flac, .m4a, .aac, .ogg)",
      };
    }
    const base = path.basename(p.replace(/[\\/]+$/, "")) || "Folder";
    console.log(LOG, "ok", { dir: p, count: out.length, playlistName: base });
    return { status: "ok", playlistName: base, files: out };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(LOG, "failed", p, msg);
    return { status: "error", message: `Cannot read path: ${msg}` };
  }
}
