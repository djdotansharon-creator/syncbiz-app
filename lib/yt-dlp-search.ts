/**
 * YouTube search and metadata via yt-dlp.
 * Uses yt-dlp-wrap to auto-download the binary when needed (no Python/yt-dlp pre-install required).
 */

import { canonicalYouTubeWatchUrlForPlayback, getYouTubeVideoId } from "@/lib/playlist-utils";
import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
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

const CACHE_DIR = join(process.cwd(), "node_modules", ".cache", "yt-dlp");
const isWin = typeof process !== "undefined" && process.platform === "win32";
const BINARY_NAME = isWin ? "yt-dlp.exe" : "yt-dlp";
const BINARY_PATH = join(CACHE_DIR, BINARY_NAME);
const ENV_BINARY_PATH =
  typeof process !== "undefined" && typeof process.env.YTDLP_BINARY_PATH === "string"
    ? process.env.YTDLP_BINARY_PATH.trim()
    : "";

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

async function downloadYtDlpBinary(): Promise<void> {
  const res = await fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest");
  if (!res.ok) throw new Error("Failed to fetch releases");
  const data = (await res.json()) as { tag_name?: string };
  const version = data.tag_name || "2024.01.01";
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${BINARY_NAME}`;
  const binRes = await fetch(url);
  if (!binRes.ok) throw new Error(`Failed to download: ${binRes.status}`);
  await mkdir(CACHE_DIR, { recursive: true });
  const buf = await binRes.arrayBuffer();
  await writeFile(BINARY_PATH, Buffer.from(buf));
}

async function getYtDlp(): Promise<import("yt-dlp-wrap").default | null> {
  if (ytDlpInstance) return ytDlpInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const YTDlpWrap = (await import("yt-dlp-wrap")).default;

      // 0. Production-safe explicit override (e.g. Railway image path).
      if (ENV_BINARY_PATH) {
        try {
          const wrap = new YTDlpWrap(ENV_BINARY_PATH);
          await wrap.getVersion();
          ytDlpInstance = wrap;
          return wrap;
        } catch {
          /* env override invalid/unavailable; continue fallback chain */
        }
      }

      // 1. Try system yt-dlp first
      try {
        const wrap = new YTDlpWrap("yt-dlp");
        await wrap.getVersion();
        ytDlpInstance = wrap;
        return wrap;
      } catch {
        /* system yt-dlp not found */
      }

      // 2. Try cached binary
      if (existsSync(BINARY_PATH)) {
        const wrap = new YTDlpWrap(BINARY_PATH);
        await wrap.getVersion();
        ytDlpInstance = wrap;
        return wrap;
      }

      // 3. Download binary from GitHub
      await downloadYtDlpBinary();
      const wrap = new YTDlpWrap(BINARY_PATH);
      await wrap.getVersion();
      ytDlpInstance = wrap;
      return wrap;
    } catch (e) {
      console.warn("[yt-dlp] Init failed:", e);
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
  } catch {
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
