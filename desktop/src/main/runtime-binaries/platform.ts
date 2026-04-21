/**
 * Platform-specific helpers:
 *   - `findOnPath()`    → look up a command on the user's PATH (for SystemSource).
 *   - `extractFromArchive()` → pull a single file out of a .7z/.zip/.tar.gz.
 *   - `locateSevenZip()`     → where is our bundled `7zr.exe`.
 *
 * 7z is the only archive format we currently need — shinchiro mpv Windows
 * builds — and we extract it by spawning a bundled `7zr.exe` (~480KB) from
 * `extraResources/7zr.exe`. Using a 3rd-party npm wrapper (7zip-min, node-7z)
 * would pull ~20MB of per-platform 7zip binaries; a single `7zr.exe` is
 * leaner and the same strategy used by VSCode, Etcher, and Obsidian.
 */

import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

import type { ArchiveSpec } from "./types";

// ─── PATH lookup ────────────────────────────────────────────────────────────

/**
 * Return the absolute path of `cmd` if it's on PATH, else `null`.
 * Mirrors the behaviour of `which`/`where` without shelling out.
 */
export async function findOnPath(cmd: string): Promise<string | null> {
  const PATH = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  const dirs = PATH.split(sep).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + (ext.startsWith(".") ? ext.toLowerCase() : ext));
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        /* not here, keep looking */
      }
    }
  }
  return null;
}

// ─── 7zr.exe locator ────────────────────────────────────────────────────────

/**
 * Locate the bundled `7zr.exe`. In production it lives under
 * `process.resourcesPath/7zr.exe` (`extraResources`); in dev it's at
 * `desktop/resources/7zr.exe` when present. Returns `null` when unavailable —
 * callers must handle that (only the Windows mpv path needs 7zr, and the
 * dev fallback path avoids this entire code path when a dev already has
 * `desktop/resources/mpv/mpv.exe`).
 */
export function locateSevenZip(): string | null {
  if (process.platform !== "win32") return null;
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "7zr.exe")]
    : [
        // dist/main/runtime-binaries/ → desktop/resources/7zr.exe
        path.join(__dirname, "..", "..", "..", "resources", "7zr.exe"),
        path.join(process.cwd(), "resources", "7zr.exe"),
      ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * Extract a single file (`archive.pickFile`) out of `archivePath` into
 * `destPath`. Intermediate dirs are created. The archive stays untouched so
 * callers can retry without re-downloading.
 */
export async function extractFromArchive(
  archivePath: string,
  destPath: string,
  archive: ArchiveSpec,
): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  if (archive.kind === "raw") {
    // Not an archive — just move.
    await fs.rename(archivePath, destPath);
    return;
  }

  if (archive.kind === "7z") {
    const sevenZ = locateSevenZip();
    if (!sevenZ) {
      throw new Error(
        "7zr.exe not found. Place it at desktop/resources/7zr.exe (dev) or make sure electron-builder.extraResources includes it (prod).",
      );
    }
    // Flat-extract (`e`) just the one file we care about, into a fresh temp
    // dir, then rename that file to the final destination. This avoids
    // spraying the archive's full tree onto disk.
    const workDir = await fs.mkdtemp(path.join(app.getPath("temp"), "syncbiz-7z-"));
    try {
      await runProcess(sevenZ, ["e", "-y", `-o${workDir}`, archivePath, archive.pickFile]);
      const extracted = path.join(workDir, archive.pickFile);
      if (!existsSync(extracted)) {
        throw new Error(`7zr ran but did not produce ${archive.pickFile} in archive`);
      }
      await fs.rename(extracted, destPath);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
    return;
  }

  if (archive.kind === "zip" || archive.kind === "tar.gz") {
    // Placeholder — not needed today. When a future source needs .zip we'll
    // add `yauzl` (~30KB, zero deps) or Node built-in `zlib`+`tar`. Throwing
    // now keeps the type exhaustive without silently wrong behaviour.
    throw new Error(`extractor not implemented for archive kind: ${archive.kind}`);
  }

  const never: never = archive;
  throw new Error(`unsupported archive: ${JSON.stringify(never)}`);
}

function runProcess(exe: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString("utf-8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${path.basename(exe)} exited with code ${code}: ${stderr.slice(0, 600)}`));
    });
  });
}
