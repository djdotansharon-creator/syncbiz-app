import { NextRequest, NextResponse } from "next/server";
import { inferPlaylistType, getYouTubeThumbnail } from "@/lib/playlist-utils";

type MetadataResult = {
  title: string;
  genre: string;
  cover: string | null;
  type: string;
};

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const u = url.trim();
  const type = inferPlaylistType(u);

  const result: MetadataResult = {
    title: "",
    genre: "Mixed",
    cover: null,
    type,
  };

  // YouTube / SoundCloud / Spotify: use noembed for title + thumbnail
  if (type === "youtube" || type === "soundcloud" || type === "spotify") {
    try {
      const res = await fetch(
        `https://noembed.com/embed?url=${encodeURIComponent(u)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { title?: string; thumbnail_url?: string };
        if (data.title) result.title = data.title;
        if (data.thumbnail_url) result.cover = data.thumbnail_url;
      }
    } catch {
      // noembed failed, fall back to built-in
    }

    // YouTube: built-in thumbnail if noembed didn't provide
    if (type === "youtube" && !result.cover) {
      result.cover = getYouTubeThumbnail(u);
    }
    if (type === "youtube" && !result.title) {
      const vid = u.match(/(?:v=|\/)([^&\s?/]+)/)?.[1];
      result.title = vid ? `YouTube ${vid}` : "YouTube video";
    }
  }

  // Winamp M3U: try to read first track if it's a local path we can access
  if (type === "winamp" || type === "local") {
    result.title = result.title || "Local playlist";
    result.cover = null;
    // Server-side M3U parsing would require file system access to the path
    // For local paths, we cannot fetch - user would need to provide path
  }

  if (!result.title) {
    result.title = type === "stream-url" ? "Stream" : "Untitled";
  }

  return NextResponse.json(result);
}
