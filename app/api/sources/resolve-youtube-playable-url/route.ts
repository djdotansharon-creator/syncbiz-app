import { NextRequest, NextResponse } from "next/server";
import { getYouTubePlaylistId, getYouTubeVideoId } from "@/lib/playlist-utils";
import { resolveYouTubeFirstVideoUrlFromPlaylistUrl } from "@/lib/yt-dlp-search";

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string };
    const raw = typeof url === "string" ? url.trim() : "";
    if (!raw) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    // If it's already a video URL (has `v=`), keep it as-is.
    const existingVid = getYouTubeVideoId(raw);
    if (existingVid) {
      return NextResponse.json({ playableUrl: raw });
    }

    // For playlist/mix URLs, we need to add a real `v=` videoId so embedded playback can start.
    const playlistId = getYouTubePlaylistId(raw);
    if (!playlistId) {
      return NextResponse.json({ playableUrl: raw });
    }

    const firstVideoUrl = await resolveYouTubeFirstVideoUrlFromPlaylistUrl(raw);
    const firstVid = firstVideoUrl ? getYouTubeVideoId(firstVideoUrl) : null;
    if (!firstVid) {
      return NextResponse.json({ playableUrl: raw });
    }

    let params: URLSearchParams;
    try {
      params = new URL(raw).searchParams;
    } catch {
      params = new URLSearchParams();
    }

    // Ensure list + v exist and keep any extra params (e.g. start_radio=1).
    params.set("list", playlistId);
    params.set("v", firstVid);

    const playableUrl = `https://www.youtube.com/watch?${params.toString()}`;
    return NextResponse.json({ playableUrl, firstVid });
  } catch (e) {
    return NextResponse.json({ error: "Failed to resolve playable YouTube URL" }, { status: 500 });
  }
}

