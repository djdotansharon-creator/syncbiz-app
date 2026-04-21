/**
 * Core binary resolution logic.
 *
 * Resolution order for a binary on a given platform:
 *
 *   1. Dev fallback (unpackaged builds only)
 *      ─ `desktop/resources/<legacy path>/<exe>`
 *        Keeps the existing dev workflow working with no changes: a dev who
 *        already dropped `mpv.exe` + `yt-dlp.exe` under `desktop/resources/mpv/`
 *        never hits the network.
 *
 *   2. User cache (production + dev without fallback)
 *      ─ `userData/bin/<exe>` described in `manifest.json`.
 *        If the file exists, the manifest entry's sha256 matches the file,
 *        and the manifest version matches our schema, we reuse it.
 *
 *   3. Live resolve
 *      ─ `github-release` → hit GitHub API, pick asset, download, verify, extract, cache.
 *      ─ `system`         → look up on PATH.
 *
 * Any downloaded binaries end up in `userData/bin/<outputFileName>`, which
 * persists across app upgrades (electron-builder does not touch userData)
 * so reinstalls reuse the cached binaries.
 */

import { createHash } from "node:crypto";
import { createReadStream, promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

import {
  RUNTIME_BINARY_SOURCES,
  currentPlatformKey,
  resolveEffectiveUrl,
} from "./sources";
import type {
  BinaryName,
  BinarySource,
  GithubReleaseSource,
  ManifestEntry,
  ResolveProgressHandler,
  ResolvedBinary,
} from "./types";
import {
  fetchLatestRelease,
  fetchText,
  downloadToFile,
  type GithubRelease,
} from "./net";
import { extractFromArchive, findOnPath } from "./platform";
import { binDir, getEntry, updateEntry } from "./manifest";

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Ensure a single binary is available and return its path + metadata.
 *
 * Pass `{ forceRefresh: true }` to bypass the cached manifest entry and
 * re-check upstream for a newer version (used by the weekly yt-dlp job).
 */
export async function resolveBinary(
  name: BinaryName,
  opts?: { forceRefresh?: boolean; onProgress?: ResolveProgressHandler },
): Promise<ResolvedBinary> {
  const platformKey = currentPlatformKey();
  if (!platformKey) {
    throw new Error(`unsupported platform ${process.platform}/${process.arch}`);
  }
  const source = RUNTIME_BINARY_SOURCES[name]?.[platformKey];
  if (!source) {
    throw new Error(`no source configured for ${name} on ${platformKey}`);
  }

  // Step 1 — dev fallback.
  if (!app.isPackaged) {
    const dev = resolveDevFallback(name);
    if (dev) {
      return {
        name,
        path: dev,
        version: "dev-fallback",
        fromCache: true,
        fromSystemPath: false,
        fromDevFallback: true,
      };
    }
  }

  // Step 2 — user cache (skipped when forceRefresh is set).
  if (!opts?.forceRefresh) {
    const cached = await readValidCache(name);
    if (cached) {
      return {
        name,
        path: cached.path,
        version: cached.version,
        fromCache: true,
        fromSystemPath: false,
        fromDevFallback: false,
      };
    }
  }

  // Step 3 — live resolve.
  if (source.kind === "system") {
    const sysPath = await findOnPath(source.command);
    if (!sysPath) {
      const err = new Error(
        `${name} is not installed. Please install it (${source.installHint}) and relaunch SyncBiz. See ${source.helpUrl}`,
      );
      (err as Error & { code?: string }).code = "SYSTEM_BINARY_MISSING";
      throw err;
    }
    await updateEntry(name, {
      name,
      path: sysPath,
      version: "system",
      sha256: "system",
      installedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      sourceKind: "system",
    });
    return {
      name,
      path: sysPath,
      version: "system",
      fromCache: false,
      fromSystemPath: true,
      fromDevFallback: false,
    };
  }

  return await downloadFromGithub(name, source, opts?.onProgress);
}

/**
 * Resolve every binary in `names`. Returns a map of name → path on success;
 * throws on the first failure. `onProgress` is forwarded to each per-binary
 * resolve so the first-run UI can show a single unified progress stream.
 */
export async function resolveAll(
  names: BinaryName[],
  onProgress?: ResolveProgressHandler,
): Promise<Record<BinaryName, string>> {
  const out: Record<string, string> = {};
  for (const name of names) {
    onProgress?.({ binary: name, phase: `Checking ${name}`, percent: 0 });
    const res = await resolveBinary(name, { onProgress });
    out[name] = res.path;
    onProgress?.({ binary: name, phase: `${name} ready`, percent: 100 });
  }
  return out as Record<BinaryName, string>;
}

// ─── Dev fallback ───────────────────────────────────────────────────────────

/**
 * Map a binary name to its historic `desktop/resources/...` location. Only
 * honoured in dev; in packaged builds these paths don't exist because we've
 * stopped shipping the binaries.
 */
function resolveDevFallback(name: BinaryName): string | null {
  if (process.platform !== "win32") return null; // dev fallback only existed for the Windows dev flow
  const exeName = name === "mpv" ? "mpv.exe" : "yt-dlp.exe";
  const candidates = [
    // dist/main/runtime-binaries/ → desktop/resources/mpv/
    path.join(__dirname, "..", "..", "..", "resources", "mpv", exeName),
    path.join(process.cwd(), "resources", "mpv", exeName),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// ─── Cache validation ───────────────────────────────────────────────────────

type CacheHit = { path: string; version: string };

async function readValidCache(name: BinaryName): Promise<CacheHit | null> {
  const entry = await getEntry(name);
  if (!entry) return null;
  if (!existsSync(entry.path)) return null;
  // For `system`/`dev-fallback` entries we trust presence — no hash to verify.
  if (entry.sha256 === "system" || entry.sha256 === "dev-fallback" || entry.sha256 === "tls-only") {
    return { path: entry.path, version: entry.version };
  }
  const actual = await sha256File(entry.path);
  if (actual !== entry.sha256) {
    // Disk corruption or user-edited binary — refuse the cache.
    return null;
  }
  return { path: entry.path, version: entry.version };
}

// ─── github-release fetch path ──────────────────────────────────────────────

async function downloadFromGithub(
  name: BinaryName,
  source: GithubReleaseSource,
  onProgress?: ResolveProgressHandler,
): Promise<ResolvedBinary> {
  onProgress?.({ binary: name, phase: `Looking up ${name} release`, percent: -1 });
  const release = await fetchLatestRelease(source.owner, source.repo);
  const version = release.tag_name || release.name || "unknown";

  const asset = pickAsset(release, new RegExp(source.assetPattern));
  if (!asset) {
    throw new Error(
      `no asset matching /${source.assetPattern}/ in ${source.owner}/${source.repo}@${version}`,
    );
  }

  // Optional SHA256 sidecar. We fetch it BEFORE downloading the binary so
  // that if the sidecar is ever unavailable we can fail fast.
  let expectedSha256: string | null = null;
  if (source.integritySidecar) {
    const sidecar = pickAsset(release, new RegExp(source.integritySidecar.assetPattern));
    if (!sidecar) {
      throw new Error(
        `integrity sidecar /${source.integritySidecar.assetPattern}/ not found in ${source.owner}/${source.repo}@${version}`,
      );
    }
    const sumsText = await fetchText(resolveEffectiveUrl(sidecar.browser_download_url));
    expectedSha256 = extractSha256(sumsText, new RegExp(source.integritySidecar.pickPattern, "m"));
    if (!expectedSha256) {
      throw new Error(
        `sidecar ${sidecar.name} did not contain a line matching /${source.integritySidecar.pickPattern}/`,
      );
    }
  }

  // Download to a temp path inside `userData/bin/`. On Windows we have to
  // write the archive somewhere before 7zr can extract from it.
  const targetDir = binDir();
  await fs.mkdir(targetDir, { recursive: true });
  const finalPath = path.join(targetDir, source.outputFileName);
  const archiveKind = source.archive?.kind ?? "raw";
  const downloadPath = archiveKind === "raw"
    ? finalPath
    : path.join(targetDir, `.${name}-archive-${Date.now()}`);

  const url = resolveEffectiveUrl(asset.browser_download_url);
  onProgress?.({ binary: name, phase: `Downloading ${name} ${version}`, percent: 0 });
  await downloadToFile(url, downloadPath, (hp) => {
    onProgress?.({
      binary: name,
      phase: `Downloading ${name} ${version}`,
      percent: hp.bytesTotal > 0 ? hp.percent : -1,
    });
  });

  // Verify integrity BEFORE extraction. For archives we hash the archive,
  // not the extracted binary (matches how the SHA sidecars are published
  // for file types we'll add later like .zip/.tar.gz).
  if (expectedSha256 && archiveKind === "raw") {
    onProgress?.({ binary: name, phase: `Verifying ${name}`, percent: 100 });
    const actual = await sha256File(downloadPath);
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      await fs.rm(downloadPath, { force: true });
      throw new Error(`sha256 mismatch for ${name}: expected ${expectedSha256} got ${actual}`);
    }
  }

  // Extract (no-op for raw — `downloadPath === finalPath`).
  let finalSha256: string;
  if (source.archive && source.archive.kind !== "raw") {
    onProgress?.({ binary: name, phase: `Extracting ${name}`, percent: -1 });
    await extractFromArchive(downloadPath, finalPath, source.archive);
    await fs.rm(downloadPath, { force: true });
    // After extraction we hash the extracted file so the cache check next
    // launch is meaningful even without an upstream sidecar.
    finalSha256 = await sha256File(finalPath);
  } else {
    finalSha256 = expectedSha256 ?? (await sha256File(finalPath));
  }

  // chmod +x on *nix so the binary is executable right after a fresh install.
  if (process.platform !== "win32") {
    try {
      await fs.chmod(finalPath, 0o755);
    } catch {
      /* best-effort; if this fails the user will get a clearer error at spawn-time */
    }
  }

  const entry: ManifestEntry = {
    name,
    path: finalPath,
    version,
    sha256: source.archive && source.archive.kind !== "raw" && !expectedSha256
      ? finalSha256
      : (expectedSha256 ?? "tls-only"),
    installedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    sourceKind: "github-release",
  };
  await updateEntry(name, entry);

  return {
    name,
    path: finalPath,
    version,
    fromCache: false,
    fromSystemPath: false,
    fromDevFallback: false,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickAsset(release: GithubRelease, pattern: RegExp): GithubRelease["assets"][number] | null {
  for (const a of release.assets ?? []) {
    if (pattern.test(a.name)) return a;
  }
  return null;
}

function extractSha256(text: string, pattern: RegExp): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(pattern);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

/**
 * Lightweight "is there a newer release?" check. Used by the background
 * updater — we DON'T want to pay download cost here, only the one API call.
 * Returns `true` if the upstream tag differs from the cached entry's version.
 */
export async function hasUpstreamUpdate(name: BinaryName): Promise<boolean> {
  const platformKey = currentPlatformKey();
  if (!platformKey) return false;
  const source: BinarySource | undefined = RUNTIME_BINARY_SOURCES[name]?.[platformKey];
  if (!source || source.kind !== "github-release") return false;
  const entry = await getEntry(name);
  if (!entry) return true;
  try {
    const release = await fetchLatestRelease(source.owner, source.repo);
    return (release.tag_name || release.name || "") !== entry.version;
  } catch {
    return false;
  }
}
