import { NextRequest, NextResponse } from "next/server";
import { getPlaylist, updatePlaylist } from "@/lib/playlist-store";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { resolveYouTubeMetadata } from "@/lib/youtube-metadata-resolver";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playlist = await getPlaylist(id);
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }

  if (playlist.type !== "youtube" || !playlist.url) {
    return NextResponse.json(
      { error: "Only YouTube playlists can be refreshed" },
      { status: 400 },
    );
  }

  const vid = getYouTubeVideoId(playlist.url);
  if (!vid) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  const meta = await resolveYouTubeMetadata(playlist.url, { forceRefresh: true });
  const viewCount = meta?.viewCount;
  const durationSeconds = meta?.durationSeconds;

  if (viewCount == null && durationSeconds == null) {
    return NextResponse.json(
      { error: "Could not fetch metadata (YouTube API key or yt-dlp required)" },
      { status: 503 },
    );
  }

  const updateData: { viewCount?: number; durationSeconds?: number } = {};
  if (typeof viewCount === "number") updateData.viewCount = viewCount;
  if (typeof durationSeconds === "number") updateData.durationSeconds = durationSeconds;

  const updated = await updatePlaylist(id, updateData);
  return NextResponse.json(updated);
}
