/**
 * YouTube search and metadata via yt-dlp.
 * Uses yt-dlp-wrap to auto-download the binary when needed (no Python/yt-dlp pre-install required).
 */

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

const TIMEOUT_MS = 15000;

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
