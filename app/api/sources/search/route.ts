import { NextRequest, NextResponse } from "next/server";
import { parseSearchIntent } from "@/lib/search-intent";
import { searchYouTubeWithApi } from "@/lib/youtube-api-search";
import { searchYouTubeWithYtDlp } from "@/lib/yt-dlp-search";

type SearchResult = {
  title: string;
  url: string;
  cover: string | null;
  type: "youtube" | "soundcloud";
  viewCount?: number;
  durationSeconds?: number;
};

export type RadioSearchResult = {
  title: string;
  url: string;
  cover: string | null;
  genre: string;
};

const RESULT_LIMIT = 15;
const RADIO_LIMIT = 10;
const RADIO_BROWSER_API = "https://de1.api.radio-browser.info";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results: SearchResult[] = [];
  const parsed = parseSearchIntent(q);

  // 1. YouTube Data API (when YOUTUBE_API_KEY is set) – real YouTube search engine
  if (process.env.YOUTUBE_API_KEY) {
    try {
      const apiResults = await searchYouTubeWithApi(
        parsed.query,
        parsed.sortByViews ? "viewCount" : "relevance",
        RESULT_LIMIT,
        {
          publishedAfter: parsed.publishedAfter,
          publishedBefore: parsed.publishedBefore,
        }
      );
      for (const r of apiResults) {
        results.push({ title: r.title, url: r.url, cover: r.cover, type: "youtube", viewCount: r.viewCount, durationSeconds: r.durationSeconds });
      }
    } catch (e) {
      console.warn("[sources/search] YouTube API failed:", e);
    }
  }

  // 2. youtube-search-without-api-key (no API key, yt-dlp failed or not installed)
  if (results.length === 0) {
    try {
      const yt = await import("youtube-search-without-api-key");
      const ytResults = await yt.search(parsed.query);
      for (const r of (ytResults || []).slice(0, RESULT_LIMIT)) {
        const url = r.url || (r.id?.videoId ? `https://www.youtube.com/watch?v=${r.id.videoId}` : null);
        if (url) {
          const thumb =
            r.snippet?.thumbnails?.high?.url ||
            r.snippet?.thumbnails?.default?.url ||
            r.snippet?.thumbnails?.url ||
            (r.id?.videoId ? `https://img.youtube.com/vi/${r.id.videoId}/hqdefault.jpg` : null);
          const views = (r as { views?: number }).views;
          results.push({
            title: r.title || r.snippet?.title || "YouTube video",
            url,
            cover: thumb,
            type: "youtube",
            viewCount: typeof views === "number" ? views : undefined,
          });
        }
      }
    } catch (e) {
      console.warn("[sources/search] youtube-search-without-api-key failed:", e);
    }
  }

  // 3. yt-dlp last resort (if npm package also failed)
  if (results.length === 0) {
    try {
      const ytDlpResults = await searchYouTubeWithYtDlp(parsed.query, RESULT_LIMIT);
      for (const r of ytDlpResults) {
        results.push({
          title: r.title,
          url: r.url,
          cover: r.cover,
          type: "youtube",
          viewCount: r.view_count,
          durationSeconds: typeof r.duration === "number" ? Math.round(r.duration) : undefined,
        });
      }
    } catch (e) {
      console.warn("[sources/search] yt-dlp search failed:", e);
    }
  }

  // 4. Radio Browser API – internet radio stations (in parallel, non-blocking)
  let radioResults: RadioSearchResult[] = [];
  try {
    const radioRes = await fetch(
      `${RADIO_BROWSER_API}/json/stations/search?name=${encodeURIComponent(parsed.query)}&limit=${RADIO_LIMIT}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (radioRes.ok) {
      const stations = (await radioRes.json()) as Array<{
        name?: string;
        url_resolved?: string;
        url?: string;
        favicon?: string;
        tags?: string;
      }>;
      for (const s of stations) {
        const streamUrl = s.url_resolved || s.url;
        if (streamUrl && (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"))) {
          radioResults.push({
            title: s.name || "Radio station",
            url: streamUrl,
            cover: s.favicon || null,
            genre: s.tags?.split(",")[0]?.trim() || "Radio",
          });
        }
      }
    }
  } catch (e) {
    console.warn("[sources/search] Radio Browser API failed:", e);
  }

  return NextResponse.json({ results, radioResults });
}
