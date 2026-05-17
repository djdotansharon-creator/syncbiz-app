/**
 * One-level directory listing under the configured music folder root (Desktop main process).
 * Paths are constrained to stay under the saved music folder — no whole-filesystem browse.
 */

import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { ListMusicLibraryDirResult } from "../shared/mvp-types";

const AUDIO_EXTS = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]);

function normalizeRoot(root: string): string | null {
  const t = (root ?? "").trim();
  if (!t) return null;
  return path.resolve(t);
}

/**
 * Resolves `subPath` (relative, forward-slash segments, no "..") under `rootNorm`.
 */
export function resolveMusicLibrarySubdir(rootNorm: string, subPath: string): string | null {
  const raw = (subPath ?? "").replace(/^[\\/]+/, "");
  const segments = raw
    ? raw.split(/[/\\]+/).filter((s) => s.length > 0 && s !== "." && s !== "..")
    : [];
  for (const seg of segments) {
    if (seg === "..") return null;
  }
  const full = path.resolve(rootNorm, ...segments);
  const rel = path.relative(rootNorm, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

export async function listMusicLibraryDir(
  musicRoot: string | null | undefined,
  subPath: string,
): Promise<ListMusicLibraryDirResult> {
  const rootNorm = musicRoot?.trim() ? normalizeRoot(musicRoot!) : null;
  if (!rootNorm) {
    return { status: "no_root" };
  }

  const dir = resolveMusicLibrarySubdir(rootNorm, subPath);
  if (!dir) {
    return { status: "error", message: "Invalid path" };
  }

  let dirents: Dirent[];
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "error", message: msg };
  }

  const dirs: { name: string; path: string }[] = [];
  const files: { name: string; path: string }[] = [];

  for (const d of dirents) {
    const name = d.name as string;
    if (name === "." || name === "..") continue;
    const full = path.join(dir, name);
    if (d.isDirectory()) {
      dirs.push({ name, path: full });
    } else if (d.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (AUDIO_EXTS.has(ext)) {
        files.push({ name, path: full });
      }
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  return { status: "ok", dirs, files };
}
