/**
 * YouTube Data API v3 search – mirrors YouTube's real search engine.
 * Use when YOUTUBE_API_KEY is set in environment.
 * Free tier: ~100 searches/day (10,000 units, 100 per search).
 */

import { parseIso8601Duration } from "@/lib/format-utils";

export type YouTubeApiResult = {
  id: string;
  title: string;
  url: string;
  cover: string | null;
  viewCount?: number;
  durationSeconds?: number;
};

type VideoMetadata = { viewCount?: number; durationSeconds?: number };

async function fetchVideoMetadata(
  key: string,
  videoIds: string[]
): Promise<Record<string, VideoMetadata>> {
  if (videoIds.length === 0) return {};
  const params = new URLSearchParams({
    part: "statistics,contentDetails",
    id: videoIds.join(","),
    key,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!res.ok) return {};
  const data = (await res.json()) as {
    items?: Array<{
      id?: string;
      statistics?: { viewCount?: string };
      contentDetails?: { duration?: string };
    }>;
  };
  const map: Record<string, VideoMetadata> = {};
  for (const item of data.items || []) {
    const id = item.id;
    if (!id) continue;
    const meta: VideoMetadata = {};
    const count = item.statistics?.viewCount;
    if (count !== undefined) meta.viewCount = parseInt(count, 10) || 0;
    const dur = item.contentDetails?.duration;
    if (dur) meta.durationSeconds = parseIso8601Duration(dur);
    map[id] = meta;
  }
  return map;
}

export async function searchYouTubeWithApi(
  query: string,
  order: "relevance" | "viewCount" = "relevance",
  maxResults = 15,
  opts?: { publishedAfter?: string; publishedBefore?: string }
): Promise<YouTubeApiResult[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !key.trim()) return [];

  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    maxResults: String(maxResults),
    order,
    key,
  });
  if (opts?.publishedAfter) params.set("publishedAfter", opts.publishedAfter);
  if (opts?.publishedBefore) params.set("publishedBefore", opts.publishedBefore);

  const url = `https://www.googleapis.com/youtube/v3/search?${params}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        thumbnails?: { high?: { url?: string }; default?: { url?: string } };
      };
    }>;
  };

  const results: YouTubeApiResult[] = [];
  const ids: string[] = [];
  for (const item of data.items || []) {
    const videoId = item.id?.videoId;
    if (!videoId) continue;
    ids.push(videoId);
    const title = item.snippet?.title || "YouTube video";
    const thumb =
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.default?.url ||
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    results.push({
      id: videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      cover: thumb,
    });
  }
  const meta = await fetchVideoMetadata(key, ids);
  for (const r of results) {
    const m = meta[r.id];
    if (m?.viewCount !== undefined) r.viewCount = m.viewCount;
    if (m?.durationSeconds !== undefined) r.durationSeconds = m.durationSeconds;
  }
  return results;
}

/** Fetch view count and duration for a single YouTube video ID. */
export async function fetchYouTubeMetadataByApi(videoId: string): Promise<VideoMetadata | undefined> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !key.trim()) return undefined;
  const map = await fetchVideoMetadata(key, [videoId]);
  return map[videoId];
}

/** Fetch view count for a single YouTube video ID. Returns undefined if API key missing or fetch fails. */
export async function fetchYouTubeViewCountByApi(videoId: string): Promise<number | undefined> {
  const meta = await fetchYouTubeMetadataByApi(videoId);
  return meta?.viewCount;
}
