/**
 * YouTube search and metadata via yt-dlp.
 * Uses yt-dlp-wrap to auto-download the binary when needed (no Python/yt-dlp pre-install required).
 */

import { canonicalYouTubeWatchUrlForPlayback, getYouTubeVideoId } from "@/lib/playlist-utils";
import { join } from "path";
import { chmod, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";

export type YtDlpResult = {
  id: string;
  title: string;
  url: string;
  cover: string | null;
  view_count?: number;
  duration?: number;
};

export type YouTubeMetadata = { viewCount?: number; durationSeconds?: number };

const DEFAULT_CACHE_DIR = join(process.cwd(), "node_modules", ".cache", "yt-dlp");
const CACHE_DIR = (() => {
  const override =
    typeof process !== "undefined" && typeof process.env.YTDLP_CACHE_DIR === "string"
      ? process.env.YTDLP_CACHE_DIR.trim()
      : "";
  if (override) return override;
  // Railway runtime safety: prefer writable tmp cache over app/node_modules path.
  if (typeof process !== "undefined" && process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return "/tmp/yt-dlp";
  }
  return DEFAULT_CACHE_DIR;
})();
const isWin = typeof process !== "undefined" && process.platform === "win32";
const isMac = typeof process !== "undefined" && process.platform === "darwin";
// "yt-dlp" (no suffix) on Linux is a Python script that requires Python 3.
// "yt-dlp_linux" is the standalone ELF binary — no Python dependency.
const BINARY_NAME = isWin ? "yt-dlp.exe" : isMac ? "yt-dlp_macos" : "yt-dlp_linux";
const BINARY_PATH = join(CACHE_DIR, BINARY_NAME);
const ENV_BINARY_PATH =
  typeof process !== "undefined" && typeof process.env.YTDLP_BINARY_PATH === "string"
    ? process.env.YTDLP_BINARY_PATH.trim()
    : "";

/** GitHub download is a plain file write - Linux requires +x or spawn returns EACCES. */
async function ensureYtDlpBinaryExecutable(filePath: string): Promise<void> {
  if (isWin) return;
  try {
    await chmod(filePath, 0o755);
  } catch {
    /* ignore */
  }
}

const TIMEOUT_MS = 15000;

/** Max entries returned for YouTube Mix Import candidate list (server-enforced). */
export const YOUTUBE_MIX_IMPORT_CANDIDATE_LIMIT = 25;

const MIX_ENUM_TIMEOUT_MS = 22000;

export type YouTubeMixImportCandidate = {
  videoId: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  durationSeconds?: number;
  viewCount?: number;
};

export type EnumerateYouTubeMixPlaylistResult = {
  candidates: YouTubeMixImportCandidate[];
  /** Present when enumeration failed or produced no usable leaf videos. */
  error?: string;
};

function mixCandidateFromFlatEntry(obj: Record<string, unknown>): YouTubeMixImportCandidate | null {
  const idRaw = typeof obj.id === "string" ? obj.id.trim() : "";
  if (!idRaw) return null;
  const webpage =
    (typeof obj.webpage_url === "string" && obj.webpage_url.trim()) ||
    (typeof obj.url === "string" && obj.url.trim()) ||
    "";
  const leaf = canonicalYouTubeWatchUrlForPlayback(
    webpage || `https://www.youtube.com/watch?v=${idRaw}`,
  );
  const vid = getYouTubeVideoId(leaf);
  if (!vid) return null;
  const title =
    (typeof obj.title === "string" && obj.title.trim()) ||
    (typeof obj.track === "string" && obj.track.trim()) ||
    "YouTube video";
  const durationRaw = obj.duration;
  const durationSeconds =
    typeof durationRaw === "number" && Number.isFinite(durationRaw)
      ? Math.round(durationRaw)
      : undefined;
  const vc = obj.view_count;
  const viewCount =
    typeof vc === "number" && Number.isFinite(vc) ? Math.round(vc) : undefined;
  const out: YouTubeMixImportCandidate = {
    videoId: vid,
    title,
    url: `https://www.youtube.com/watch?v=${vid}`,
    thumbnailUrl: `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
  };
  if (durationSeconds !== undefined) out.durationSeconds = durationSeconds;
  if (viewCount !== undefined) out.viewCount = viewCount;
  return out;
}

let ytDlpInstance: import("yt-dlp-wrap").default | null = null;
let initPromise: Promise<import("yt-dlp-wrap").default | null> | null = null;
let lastInitError: string | null = null;

// Pinned fallback version used when GitHub API is rate-limited.
const YTDLP_FALLBACK_VERSION = "2025.03.31";

async function downloadYtDlpBinary(): Promise<void> {
  // Add GitHub token if available to avoid 60 req/hr rate limit on Railway shared IPs.
  const githubToken =
    typeof process.env.GITHUB_TOKEN === "string" ? process.env.GITHUB_TOKEN.trim() : "";
  const headers: Record<string, string> = { "User-Agent": "syncbiz-app" };
  if (githubToken) headers["Authorization"] = `Bearer ${githubToken}`;

  let version = YTDLP_FALLBACK_VERSION;
  try {
    const relRes = await fetch(
      "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (relRes.ok) {
      const data = (await relRes.json()) as { tag_name?: string };
      if (typeof data.tag_name === "string" && data.tag_name.trim()) {
        version = data.tag_name.trim();
      }
    } else {
      console.warn(`[yt-dlp] GitHub releases API returned ${relRes.status}, using fallback version ${YTDLP_FALLBACK_VERSION}`);
    }
  } catch (e) {
    console.warn(`[yt-dlp] GitHub releases API fetch failed, using fallback version ${YTDLP_FALLBACK_VERSION}:`, e);
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${BINARY_NAME}`;
  console.log(`[yt-dlp] Downloading binary from ${url}`);
  const binRes = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!binRes.ok) throw new Error(`Failed to download yt-dlp ${version}: HTTP ${binRes.status}`);
  await mkdir(CACHE_DIR, { recursive: true });
  const buf = await binRes.arrayBuffer();
  await writeFile(BINARY_PATH, Buffer.from(buf));
  console.log(`[yt-dlp] Binary downloaded: ${BINARY_PATH} (${version})`);
}

const isRailway = Boolean(
  typeof process !== "undefined" && process.env.RAILWAY_VOLUME_MOUNT_PATH,
);

async function getYtDlp(): Promise<import("yt-dlp-wrap").default | null> {
  if (ytDlpInstance) return ytDlpInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const YTDlpWrap = (await import("yt-dlp-wrap")).default;

      // 0. Explicit binary path override (env var or Railway YTDLP_BINARY_PATH).
      if (ENV_BINARY_PATH) {
        try {
          const wrap = new YTDlpWrap(ENV_BINARY_PATH);
          await wrap.getVersion();
          console.log(`[yt-dlp] Using YTDLP_BINARY_PATH: ${ENV_BINARY_PATH}`);
          ytDlpInstance = wrap;
          return wrap;
        } catch (e) {
          console.warn("[yt-dlp] YTDLP_BINARY_PATH probe failed:", ENV_BINARY_PATH, e);
        }
      }

      // 1. On Railway: prefer the cached GitHub-downloaded binary (always latest) over the
      //    system apt yt-dlp (Debian stable ships 2023.x which YouTube blocks in 2025+).
      //    Locally: try system binary first (faster, no download needed).
      if (!isRailway) {
        try {
          const wrap = new YTDlpWrap("yt-dlp");
          await wrap.getVersion();
          console.log("[yt-dlp] Using system yt-dlp");
          ytDlpInstance = wrap;
          return wrap;
        } catch {
          /* system yt-dlp not found or too old — fall through */
        }
      }

      // 2. Try cached downloaded binary (latest from GitHub, written on first Railway boot).
      if (existsSync(BINARY_PATH)) {
        try {
          await ensureYtDlpBinaryExecutable(BINARY_PATH);
          const wrap = new YTDlpWrap(BINARY_PATH);
          await wrap.getVersion();
          console.log(`[yt-dlp] Using cached binary: ${BINARY_PATH}`);
          ytDlpInstance = wrap;
          return wrap;
        } catch (e) {
          console.warn("[yt-dlp] Cached binary probe failed, will re-download:", e);
        }
      }

      // 3. Download latest binary from GitHub.
      await downloadYtDlpBinary();
      await ensureYtDlpBinaryExecutable(BINARY_PATH);
      const wrap = new YTDlpWrap(BINARY_PATH);
      await wrap.getVersion();
      console.log(`[yt-dlp] Using freshly downloaded binary: ${BINARY_PATH}`);
      ytDlpInstance = wrap;
      return wrap;
    } catch (e) {
      lastInitError = String(e);
      console.warn("[yt-dlp] Init failed — will retry on next request:", e);
      // Clear initPromise so the next request retries instead of getting permanently stuck.
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms)
    ),
  ]);
}

function runYtDlpSearch(query: string, limit: number): Promise<YtDlpResult[]> {
  return runWithTimeout(
    (async () => {
      const wrap = await getYtDlp();
      if (!wrap) return [];

      const searchStr = `ytsearch${limit}:${query}`;
      const stdout = await wrap.execPromise([
        "--dump-json",
        "--no-warnings",
        searchStr,
      ]);

      const lines = (stdout || "").split("\n").filter((l) => l.trim());
      const results: YtDlpResult[] = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as {
            id?: string;
            title?: string;
            webpage_url?: string;
            view_count?: number;
            duration?: number;
            thumbnail?: string;
          };
          const id = obj.id || "";
          const url =
            obj.webpage_url ||
            (id ? `https://www.youtube.com/watch?v=${id}` : "");
          if (!url) continue;
          results.push({
            id,
            title: obj.title || "YouTube video",
            url,
            cover:
              obj.thumbnail ||
              (id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null),
            view_count:
              typeof obj.view_count === "number" ? obj.view_count : undefined,
            duration:
              typeof obj.duration === "number" ? obj.duration : undefined,
          });
        } catch {
          /* skip */
        }
      }
      results.sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0));
      return results;
    })(),
    TIMEOUT_MS
  ).catch(() => []);
}

export async function searchYouTubeWithYtDlp(
  query: string,
  limit = 10
): Promise<YtDlpResult[]> {
  let results = await runYtDlpSearch(query, limit);
  if (results.length === 0) {
    results = await runYtDlpSearch(query, limit);
  }
  return results;
}

const YT_DLP_TIMEOUT_MS = 10000;

/** Fetch view count and duration for a single YouTube URL via yt-dlp. Returns undefined if unavailable. */
export async function fetchYouTubeMetadataByYtDlp(
  url: string
): Promise<YouTubeMetadata | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, YT_DLP_TIMEOUT_MS);

  try {
    const wrap = await getYtDlp();
    if (!wrap) return undefined;

    const stdout = await wrap.execPromise(
      [url, "--dump-json", "--no-warnings", "--no-download"],
      {},
      controller.signal
    );
    const firstLine = (stdout || "").split("\n").find((l) => l.trim());
    if (!firstLine) return undefined;
    const obj = JSON.parse(firstLine) as { view_count?: number; duration?: number };
    const meta: YouTubeMetadata = {};
    if (typeof obj.view_count === "number") meta.viewCount = obj.view_count;
    if (typeof obj.duration === "number")
      meta.durationSeconds = Math.round(obj.duration);
    return Object.keys(meta).length > 0 ? meta : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Stage 5.9 — richer single-URL snapshot via `--dump-json` (catalog refresh fallback). */
export type YouTubeCatalogYtDlpSnapshotFields = {
  title: string | null;
  description: string | null;
  hashtags: string[];
  sourceTags: string[];
  channelTitle: string | null;
  channelId: string | null;
  publishedAt: Date | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  durationSec: number | null;
  thumbnail: string | null;
};

function extractHashtagsFromYtDlpDescription(description: string | null | undefined): string[] {
  if (!description) return [];
  const re = /#[\w\u0590-\u05FF][\w\u0590-\u05FF-]*/gu;
  const m = description.match(re);
  return m ? [...new Set(m)] : [];
}

function uploadDateToDate(uploadDate: string | undefined): Date | null {
  if (!uploadDate || uploadDate.length !== 8 || !/^\d{8}$/.test(uploadDate)) return null;
  const y = uploadDate.slice(0, 4);
  const mo = uploadDate.slice(4, 6);
  const d = uploadDate.slice(6, 8);
  const dt = new Date(`${y}-${mo}-${d}T12:00:00.000Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export async function fetchYouTubeCatalogSnapshotByYtDlp(
  url: string,
): Promise<{ fields: YouTubeCatalogYtDlpSnapshotFields; raw: unknown } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, YT_DLP_TIMEOUT_MS);

  try {
    const wrap = await getYtDlp();
    if (!wrap) return null;

    const stdout = await wrap.execPromise(
      [url, "--dump-json", "--no-warnings", "--no-download"],
      {},
      controller.signal,
    );
    const firstLine = (stdout || "").split("\n").find((l) => l.trim());
    if (!firstLine) return null;
    const obj = JSON.parse(firstLine) as Record<string, unknown>;

    const title = typeof obj.title === "string" ? obj.title : null;
    const description = typeof obj.description === "string" ? obj.description : null;
    const tagsRaw = obj.tags;
    const sourceTags = Array.isArray(tagsRaw)
      ? tagsRaw.filter((x): x is string => typeof x === "string")
      : [];
    const hashtags = extractHashtagsFromYtDlpDescription(description);
    const channelTitle = typeof obj.channel === "string" ? obj.channel : null;
    const channelId = typeof obj.channel_id === "string" ? obj.channel_id : null;
    const publishedAt = uploadDateToDate(
      typeof obj.upload_date === "string" ? obj.upload_date : undefined,
    );

    const thumb = typeof obj.thumbnail === "string" ? obj.thumbnail : null;

    const vc = obj.view_count;
    const viewCount = typeof vc === "number" && Number.isFinite(vc) ? Math.round(vc) : null;

    const lk = obj.like_count;
    const likeCount = typeof lk === "number" && Number.isFinite(lk) ? Math.round(lk) : null;

    const cc = obj.comment_count;
    const commentCount = typeof cc === "number" && Number.isFinite(cc) ? Math.round(cc) : null;

    const dur = obj.duration;
    const durationSec =
      typeof dur === "number" && Number.isFinite(dur) ? Math.round(dur) : null;

    const fields: YouTubeCatalogYtDlpSnapshotFields = {
      title,
      description,
      hashtags,
      sourceTags,
      channelTitle,
      channelId,
      publishedAt,
      viewCount,
      likeCount,
      commentCount,
      durationSec,
      thumbnail: thumb,
    };

    const usable =
      title?.trim() ||
      durationSec !== null ||
      viewCount !== null ||
      description?.trim() ||
      sourceTags.length > 0;

    return usable ? { fields, raw: obj } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Fetch view count for a single YouTube URL via yt-dlp. Returns undefined if unavailable. */
export async function fetchYouTubeViewCountByYtDlp(
  url: string
): Promise<number | undefined> {
  const meta = await fetchYouTubeMetadataByYtDlp(url);
  return meta?.viewCount;
}

/**
 * Resolve the first video's watch URL for a YouTube playlist/mix URL.
 * Used to normalize search-selected URLs so the embedded player can start (needs a `v=` videoId).
 */
export async function resolveYouTubeFirstVideoUrlFromPlaylistUrl(
  url: string
): Promise<string | null> {
  const wrap = await getYtDlp();
  if (!wrap) return null;

  const stdout = await runWithTimeout(
    wrap.execPromise(
      // Extract only the first item. `--flat-playlist` reduces nesting, `--playlist-items 1` limits output.
      [url, "--dump-json", "--no-warnings", "--no-download", "--flat-playlist", "--playlist-items", "1"],
    ),
    TIMEOUT_MS
  ).catch(() => null);

  const raw = typeof stdout === "string" ? stdout : "";
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown> & { id?: string; webpage_url?: string; entries?: unknown[] };

      // Common case: a single video object with `id` / `webpage_url`.
      const id = typeof obj.id === "string" ? obj.id : undefined;
      const webpageUrl = typeof obj.webpage_url === "string" ? obj.webpage_url : undefined;
      if (webpageUrl) return webpageUrl;
      if (id) return `https://www.youtube.com/watch?v=${id}`;

      // Fallback: playlist-like object with `entries`.
      const entries = Array.isArray(obj.entries) ? obj.entries : null;
      if (entries && entries.length > 0) {
        const first = entries[0] as Record<string, unknown> | undefined;
        const entryId = typeof first?.id === "string" ? first.id : undefined;
        const entryWebpageUrl = typeof first?.webpage_url === "string" ? first.webpage_url : undefined;
        if (entryWebpageUrl) return entryWebpageUrl;
        if (entryId) return `https://www.youtube.com/watch?v=${entryId}`;
      }
    } catch {
      /* ignore JSON parse failures for non-JSON lines */
    }
  }

  return null;
}

/**
 * Enumerate up to `limit` leaf watch URLs from a YouTube multi-track URL (mix, radio, playlist).
 * Uses yt-dlp flat playlist extraction only — no playback or catalog side effects.
 */
export async function enumerateYouTubeMixPlaylistCandidates(
  url: string,
  limit = YOUTUBE_MIX_IMPORT_CANDIDATE_LIMIT,
): Promise<EnumerateYouTubeMixPlaylistResult> {
  const wrap = await getYtDlp();
  if (!wrap) {
    console.warn("[yt-dlp] Enumeration unavailable: init returned null", {
      hasEnvBinaryPath: Boolean(ENV_BINARY_PATH),
      isRailway: Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH),
    });
    return {
      candidates: [],
      error: "Track enumeration is unavailable.",
    };
  }

  const cap = Math.min(Math.max(1, limit), YOUTUBE_MIX_IMPORT_CANDIDATE_LIMIT);
  const binaryPath = (wrap as unknown as { binaryPath?: string }).binaryPath ?? "unknown";
  let stdout: string;
  try {
    stdout = await runWithTimeout(
      wrap.execPromise([
        url,
        "--dump-json",
        "--no-warnings",
        "--no-download",
        "--flat-playlist",
        "--playlist-items",
        `1-${cap}`,
      ]),
      MIX_ENUM_TIMEOUT_MS,
    );
  } catch (e) {
    console.error("[yt-dlp] enumerateYouTubeMixPlaylistCandidates exec failed", {
      url,
      binaryPath,
      isRailway,
      error: String(e),
      errorStack: e instanceof Error ? e.stack : undefined,
    });
    return {
      candidates: [],
      error: "Could not load tracks for this link.",
    };
  }

  const raw = typeof stdout === "string" ? stdout : "";
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const candidates: YouTubeMixImportCandidate[] = [];
  const seen = new Set<string>();

  function consume(obj: Record<string, unknown>) {
    if (candidates.length >= cap) return;
    const c = mixCandidateFromFlatEntry(obj);
    if (!c || seen.has(c.videoId)) return;
    seen.add(c.videoId);
    candidates.push(c);
  }

  for (const line of lines) {
    if (candidates.length >= cap) break;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const entries = obj.entries;
      if (Array.isArray(entries) && entries.length > 0) {
        for (const e of entries) {
          if (candidates.length >= cap) break;
          if (e && typeof e === "object") consume(e as Record<string, unknown>);
        }
      } else {
        consume(obj);
      }
    } catch {
      /* skip bad line */
    }
  }

  if (candidates.length === 0) {
    return {
      candidates: [],
      error: "No tracks found for this link.",
    };
  }
  return { candidates };
}

// ─── DIAGNOSTICS ─────────────────────────────────────────────────────────────

export type YtDlpDiagnostics = {
  instanceReady: boolean;
  binaryPath: string | null;
  version: string | null;
  versionError: string | null;
  lastInitError: string | null;
  cachedBinaryExists: boolean;
  cachedBinaryPath: string;
  cacheDir: string;
  isRailway: boolean;
  envBinaryPath: string;
  platform: string;
  python3Available: boolean | null;
};

/** Probe the current yt-dlp state and return a full diagnostic snapshot. */
export async function getYtDlpDiagnostics(): Promise<YtDlpDiagnostics> {
  const wrap = await getYtDlp();
  const binaryPath = wrap
    ? ((wrap as unknown as { binaryPath?: string }).binaryPath ?? null)
    : null;

  let version: string | null = null;
  let versionError: string | null = null;
  if (wrap) {
    try {
      version = (await wrap.getVersion()).trim();
    } catch (e) {
      versionError = String(e);
    }
  }

  let python3Available: boolean | null = null;
  if (!isWin) {
    try {
      const { execFile } = await import("child_process");
      await new Promise<void>((res, rej) =>
        execFile("python3", ["--version"], { timeout: 3000 }, (err) =>
          err ? rej(err) : res(),
        ),
      );
      python3Available = true;
    } catch {
      python3Available = false;
    }
  }

  return {
    instanceReady: wrap !== null,
    binaryPath,
    version,
    versionError,
    lastInitError,
    cachedBinaryExists: existsSync(BINARY_PATH),
    cachedBinaryPath: BINARY_PATH,
    cacheDir: CACHE_DIR,
    isRailway,
    envBinaryPath: ENV_BINARY_PATH,
    platform: process.platform,
    python3Available,
  };
}
