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

// ── Stage 5.9 — full `videos.list` snapshot (catalog source metadata refresh; not used for search ranking).

function extractHashtagsFromDescription(description: string | null | undefined): string[] {
  if (!description) return [];
  const re = /#[\w\u0590-\u05FF][\w\u0590-\u05FF-]*/gu;
  const m = description.match(re);
  return m ? [...new Set(m)] : [];
}

export type YouTubeCatalogApiSnapshotFields = {
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

/**
 * `videos.list` with snippet + statistics + contentDetails. Returns null if API key missing or request fails.
 */
export async function fetchYouTubeCatalogSnapshotViaApi(
  videoId: string,
): Promise<{ fields: YouTubeCatalogApiSnapshotFields; raw: unknown } | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !key.trim()) return null;

  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    id: videoId,
    key,
  });
  let res: Response;
  try {
    res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const raw = (await res.json()) as {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        description?: string;
        tags?: string[];
        channelId?: string;
        channelTitle?: string;
        publishedAt?: string;
        thumbnails?: {
          maxres?: { url?: string };
          high?: { url?: string };
          medium?: { url?: string };
          default?: { url?: string };
        };
      };
      statistics?: {
        viewCount?: string;
        likeCount?: string;
        commentCount?: string;
      };
      contentDetails?: { duration?: string };
    }>;
  };

  const item = raw.items?.[0];
  if (!item?.snippet) return null;

  const sn = item.snippet;
  const title = typeof sn.title === "string" ? sn.title : null;
  const description = typeof sn.description === "string" ? sn.description : null;
  const sourceTags = Array.isArray(sn.tags) ? sn.tags.map((t) => String(t)) : [];
  const hashtags = extractHashtagsFromDescription(description);
  const channelId = typeof sn.channelId === "string" ? sn.channelId : null;
  const channelTitle = typeof sn.channelTitle === "string" ? sn.channelTitle : null;
  let publishedAt: Date | null = null;
  if (typeof sn.publishedAt === "string" && sn.publishedAt.trim()) {
    const d = new Date(sn.publishedAt);
    publishedAt = Number.isNaN(d.getTime()) ? null : d;
  }

  const thumbs = sn.thumbnails;
  const thumbnail =
    thumbs?.maxres?.url ||
    thumbs?.high?.url ||
    thumbs?.medium?.url ||
    thumbs?.default?.url ||
    null;

  const st = item.statistics;
  const viewRaw = st?.viewCount;
  const viewCount =
    typeof viewRaw === "string" && viewRaw.trim() ? parseInt(viewRaw, 10) : null;
  const likeRaw = st?.likeCount;
  const likeCount =
    typeof likeRaw === "string" && likeRaw.trim() ? parseInt(likeRaw, 10) : null;
  const comRaw = st?.commentCount;
  const commentCount =
    typeof comRaw === "string" && comRaw.trim() ? parseInt(comRaw, 10) : null;

  const durStr = item.contentDetails?.duration;
  const durationSec =
    typeof durStr === "string" && durStr ? parseIso8601Duration(durStr) : null;

  const fields: YouTubeCatalogApiSnapshotFields = {
    title,
    description,
    hashtags,
    sourceTags,
    channelTitle,
    channelId,
    publishedAt,
    viewCount: viewCount !== null && Number.isFinite(viewCount) ? viewCount : null,
    likeCount: likeCount !== null && Number.isFinite(likeCount) ? likeCount : null,
    commentCount: commentCount !== null && Number.isFinite(commentCount) ? commentCount : null,
    durationSec: durationSec !== undefined && durationSec !== null ? durationSec : null,
    thumbnail,
  };

  return { fields, raw };
}
