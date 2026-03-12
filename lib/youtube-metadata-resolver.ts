/**
 * Central YouTube metadata resolver.
 * Single point of access for all YouTube metadata (views, duration, title, thumbnail).
 * - In-memory cache: prefer stale over repeated yt-dlp calls
 * - In-flight deduplication: same URL cannot trigger multiple simultaneous fetches
 * - Concurrency limit: max 2 yt-dlp processes at a time
 * - Timeout: kill hung processes
 * - Logging: cache hit, fetch start/end
 */

import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { fetchYouTubeMetadataByApi } from "@/lib/youtube-api-search";
import { fetchYouTubeMetadataByYtDlp } from "@/lib/yt-dlp-search";

export type YouTubeMetadata = {
  viewCount?: number;
  durationSeconds?: number;
  title?: string;
  thumbnail?: string;
};

const CACHE = new Map<string, YouTubeMetadata>();
const IN_FLIGHT = new Map<string, Promise<YouTubeMetadata | undefined>>();
const MAX_CONCURRENT = 2;
let activeCount = 0;
const QUEUE: Array<() => void> = [];

function normalizeKey(url: string): string | null {
  const vid = getYouTubeVideoId(url);
  return vid || null;
}

function acquire(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    QUEUE.push(() => {
      activeCount++;
      resolve();
    });
  });
}

function release(): void {
  activeCount--;
  const next = QUEUE.shift();
  if (next) next();
}

function isYouTubeUrl(url: string): boolean {
  const u = url.toLowerCase().trim();
  return u.includes("youtube.com") || u.includes("youtu.be");
}

/**
 * Resolve YouTube metadata. Uses cache first, then API, then yt-dlp.
 * Deduplicates in-flight requests. Limits concurrency.
 */
export async function resolveYouTubeMetadata(
  url: string,
  opts?: { forceRefresh?: boolean }
): Promise<YouTubeMetadata | undefined> {
  if (!url || !isYouTubeUrl(url)) return undefined;

  const key = normalizeKey(url);
  if (!key) return undefined;

  if (!opts?.forceRefresh && CACHE.has(key)) {
    const cached = CACHE.get(key)!;
    console.log(`[youtube-resolver] cache hit for ${key}`);
    return cached;
  }

  const inFlight = IN_FLIGHT.get(key);
  if (inFlight) {
    console.log(`[youtube-resolver] waiting for in-flight ${key}`);
    return inFlight;
  }

  const promise = (async (): Promise<YouTubeMetadata | undefined> => {
    await acquire();
    try {
      console.log(`[youtube-resolver] fetch start for ${key}`);
      let meta: YouTubeMetadata | undefined;

      const fromApi = await fetchYouTubeMetadataByApi(key);
      if (fromApi) {
        meta = {
          viewCount: fromApi.viewCount,
          durationSeconds: fromApi.durationSeconds,
        };
        console.log(`[youtube-resolver] fetch done (API) for ${key}`);
      } else {
        meta = await fetchYouTubeMetadataByYtDlp(url);
        if (meta) {
          console.log(`[youtube-resolver] fetch done (yt-dlp) for ${key}`);
        } else {
          console.log(`[youtube-resolver] fetch failed for ${key}`);
        }
      }

      if (meta && Object.keys(meta).length > 0) {
        CACHE.set(key, meta);
      }
      return meta;
    } finally {
      release();
      IN_FLIGHT.delete(key);
    }
  })();

  IN_FLIGHT.set(key, promise);
  return promise;
}

/** Get from cache only – no fetch. Returns undefined if not cached. */
export function getCached(url: string): YouTubeMetadata | undefined {
  const key = normalizeKey(url);
  return key ? CACHE.get(key) : undefined;
}

/** Clear cache for a URL (e.g. when URL changed). */
export function invalidateCache(url: string): void {
  const key = normalizeKey(url);
  if (key) CACHE.delete(key);
}
