import { NextRequest, NextResponse } from "next/server";

type SearchResult = {
  title: string;
  url: string;
  cover: string | null;
  type: "youtube" | "soundcloud";
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results: SearchResult[] = [];

  try {
    const { search } = await import("youtube-search-without-api-key");
    const ytResults = await search(q);
    for (const r of (ytResults || []).slice(0, 8)) {
      const url = r.url || (r.id?.videoId ? `https://www.youtube.com/watch?v=${r.id.videoId}` : null);
      if (url) {
        const thumb =
          r.snippet?.thumbnails?.high?.url ||
          r.snippet?.thumbnails?.default?.url ||
          r.snippet?.thumbnails?.url ||
          (r.id?.videoId ? `https://img.youtube.com/vi/${r.id.videoId}/hqdefault.jpg` : null);
        results.push({
          title: r.title || r.snippet?.title || "YouTube video",
          url,
          cover: thumb,
          type: "youtube",
        });
      }
    }
  } catch (e) {
    console.warn("[sources/search] YouTube search failed:", e);
  }

  return NextResponse.json({ results });
}
