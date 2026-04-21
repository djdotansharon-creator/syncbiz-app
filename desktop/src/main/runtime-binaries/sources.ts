/**
 * The ONE place that defines where SyncBiz Desktop fetches its runtime
 * binaries (mpv, yt-dlp) from. To migrate from upstream GitHub Releases to a
 * SyncBiz-owned CDN, change this file — no resolver/downloader code changes.
 *
 * Two knobs:
 *   1. `RUNTIME_BINARY_SOURCES` — the per-binary, per-platform source config.
 *   2. `resolveEffectiveUrl()` — applies the optional `SYNCBIZ_BINARY_CDN_BASE`
 *      env override that rewrites `https://github.com/...` → `<cdn>/...`.
 *      Flip one env var and we're pulling from the CDN.
 */

import type { BinarySource, BinaryName, PlatformKey } from "./types";

export function currentPlatformKey(): PlatformKey | null {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32" && a === "x64") return "win32-x64";
  if (p === "darwin" && a === "x64") return "darwin-x64";
  if (p === "darwin" && a === "arm64") return "darwin-arm64";
  if (p === "linux" && a === "x64") return "linux-x64";
  return null;
}

/**
 * When `SYNCBIZ_BINARY_CDN_BASE` is set (e.g. `https://cdn.syncbiz.app`), we
 * rewrite every GitHub-style URL's origin to the CDN while preserving path.
 * This assumes the CDN is a path-compatible mirror of GitHub's release layout
 * (standard practice: rclone/s3 sync, CloudFront).
 *
 * Leaving it unset keeps the stock behaviour: fetch directly from GitHub.
 */
export function resolveEffectiveUrl(url: string): string {
  const base = process.env.SYNCBIZ_BINARY_CDN_BASE?.trim();
  if (!base) return url;
  try {
    const src = new URL(url);
    const dst = new URL(base);
    dst.pathname = (dst.pathname.replace(/\/+$/, "") + src.pathname) || "/";
    dst.search = src.search;
    return dst.toString();
  } catch {
    return url;
  }
}

/**
 * yt-dlp publishes stable asset filenames on every release:
 *   Windows  → yt-dlp.exe
 *   macOS    → yt-dlp_macos (universal binary, runs on both x64 and arm64)
 *   Linux    → yt-dlp (glibc-linked, fine for most distros)
 * + a single `SHA2-256SUMS` sidecar covering them all.
 *
 * mpv on Windows uses shinchiro's official builds. Asset filename includes
 * the commit hash (e.g. `mpv-x86_64-v3-20250120-git-abc123.7z`) so we pick
 * by regex, not by fixed name. No sha sidecar is published — TLS-only for
 * v1, pinned hashes come when we host our own builds.
 *
 * mpv on macOS / Linux delegates to the OS package manager: the vast
 * majority of mpv users on those platforms already have it installed, and
 * shipping a static universal mpv build on macOS is a non-trivial pipeline
 * that we don't need right now. If mpv is missing the first-run window
 * tells the user exactly what to run.
 */
export const RUNTIME_BINARY_SOURCES: Record<BinaryName, Partial<Record<PlatformKey, BinarySource>>> = {
  "yt-dlp": {
    "win32-x64": {
      kind: "github-release",
      owner: "yt-dlp",
      repo: "yt-dlp",
      assetPattern: "^yt-dlp\\.exe$",
      integritySidecar: {
        assetPattern: "^SHA2-256SUMS$",
        pickPattern: "^([0-9a-fA-F]{64})\\s+yt-dlp\\.exe\\s*$",
      },
      archive: { kind: "raw" },
      outputFileName: "yt-dlp.exe",
    },
    "darwin-x64": {
      kind: "github-release",
      owner: "yt-dlp",
      repo: "yt-dlp",
      assetPattern: "^yt-dlp_macos$",
      integritySidecar: {
        assetPattern: "^SHA2-256SUMS$",
        pickPattern: "^([0-9a-fA-F]{64})\\s+yt-dlp_macos\\s*$",
      },
      archive: { kind: "raw" },
      outputFileName: "yt-dlp",
    },
    "darwin-arm64": {
      kind: "github-release",
      owner: "yt-dlp",
      repo: "yt-dlp",
      assetPattern: "^yt-dlp_macos$",
      integritySidecar: {
        assetPattern: "^SHA2-256SUMS$",
        pickPattern: "^([0-9a-fA-F]{64})\\s+yt-dlp_macos\\s*$",
      },
      archive: { kind: "raw" },
      outputFileName: "yt-dlp",
    },
    "linux-x64": {
      kind: "github-release",
      owner: "yt-dlp",
      repo: "yt-dlp",
      assetPattern: "^yt-dlp$",
      integritySidecar: {
        assetPattern: "^SHA2-256SUMS$",
        pickPattern: "^([0-9a-fA-F]{64})\\s+yt-dlp\\s*$",
      },
      archive: { kind: "raw" },
      outputFileName: "yt-dlp",
    },
  },
  mpv: {
    "win32-x64": {
      kind: "github-release",
      owner: "shinchiro",
      repo: "mpv-winbuild-cmake",
      // Shinchiro publishes a few asset variants (v2, v3, i686, etc.); we
      // pick the x86_64 v3 (SSE4.2+) build as it matches every CPU SyncBiz
      // Desktop supports on Windows.
      assetPattern: "^mpv-x86_64-v3-\\d+-git-[a-f0-9]+\\.7z$",
      archive: { kind: "7z", pickFile: "mpv.exe" },
      outputFileName: "mpv.exe",
    },
    "darwin-x64": {
      kind: "system",
      command: "mpv",
      helpUrl: "https://mpv.io/installation/#macos",
      installHint: "brew install mpv",
    },
    "darwin-arm64": {
      kind: "system",
      command: "mpv",
      helpUrl: "https://mpv.io/installation/#macos",
      installHint: "brew install mpv",
    },
    "linux-x64": {
      kind: "system",
      command: "mpv",
      helpUrl: "https://mpv.io/installation/",
      installHint: "sudo apt install mpv",
    },
  },
};
