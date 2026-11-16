/**
 * C5 step 3 SECURITY (2026-11-13) — capability-based LOCAL file access. Electron MAIN only.
 *
 * Owner product decision (2026-11-13): the operator chooses a Music folder (and may add extra folders / a
 * metadata-bank folder) via a TRUSTED Windows dialog. VONO may read music files only WITHIN those chosen roots
 * and their sub-folders. There is NO free whole-computer access. A remotely-hosted (XSS-able) renderer must not
 * be able to read arbitrary paths, nor widen the roots — the roots come only from config written by the trusted
 * dialog handlers (pickMusicFolder / addAdditionalMusicFolder / pickLocalMetadataBankFolder); the renderer never
 * supplies a root.
 *
 * `authorizeLocalRead` is the single choke point. It defends against:
 *   - relative paths and `..` traversal        → require absolute; path.resolve collapses `..`.
 *   - symlinks / junctions escaping a root      → realpath BOTH the path and the roots; compare REAL locations.
 *   - UNC / network paths                       → allowed only when under a granted root that is itself that
 *                                                 network location (operator picked a network library); a UNC
 *                                                 path not under any granted root is rejected.
 *   - odd / non-existent / NUL paths            → rejected (realpath throws → null).
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import type { DesktopRuntimeConfig } from "../shared/mvp-types";

/**
 * The real (symlink-resolved) folders the operator chose via a trusted OS dialog: the Music folder, any extra
 * folders, and the metadata-bank folder. These are the ONLY roots VONO may read local files under. A root that
 * no longer exists is skipped (so it can never widen access).
 */
export function allowedMusicRoots(cfg: DesktopRuntimeConfig): string[] {
  const raw = [cfg.musicFolderPath, ...(cfg.additionalMusicFolders ?? []), cfg.localMetadataBankPath];
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string" || !r.trim()) continue;
    try {
      out.push(realpathSync.native(path.resolve(r.trim())));
    } catch {
      /* root missing / unreadable → skip; never widen access */
    }
  }
  return Array.from(new Set(out));
}

/** True when `realPath` is the root itself or lives inside it (both already realpath-canonical). */
export function containedIn(realPath: string, realRoot: string): boolean {
  const rel = path.relative(realRoot, realPath);
  return rel === "" ? true : !(rel.startsWith("..") || path.isAbsolute(rel));
}

/**
 * Authorize a LOCAL read of `inputPath` against the dialog-chosen music roots. Returns the canonical REAL path
 * when allowed, else `null`. Requires the target to exist (realpath), so it is for reads of real files/folders.
 * The roots are read from `cfg` only — a renderer can never widen them.
 */
export function authorizeLocalRead(inputPath: unknown, cfg: DesktopRuntimeConfig): string | null {
  if (typeof inputPath !== "string") return null;
  const s = inputPath.trim();
  if (!s || s.includes("\0")) return null;
  if (!path.isAbsolute(s)) return null; // reject relative paths (and thus any ../ escape)
  let real: string;
  try {
    real = realpathSync.native(path.resolve(s)); // follow symlinks/junctions to the TRUE location; missing → throws
  } catch {
    return null;
  }
  const roots = allowedMusicRoots(cfg);
  if (roots.length === 0) return null;
  return roots.some((root) => containedIn(real, root)) ? real : null;
}
