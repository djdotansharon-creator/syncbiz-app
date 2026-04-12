import { NextRequest, NextResponse } from "next/server";
import { getPlaylist, updatePlaylist, isPlaylistPersistError } from "@/lib/playlist-store";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { gatePlaylistAccess } from "@/lib/playlist-access";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { resolveYouTubeMetadata } from "@/lib/youtube-metadata-resolver";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUserFromCookies();
  const { id } = await params;
  const playlist = await getPlaylist(id);
  const g = await gatePlaylistAccess(user ?? null, playlist);
  if (!g.allow) {
    return NextResponse.json({ error: g.message }, { status: g.httpStatus });
  }
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

  try {
    const updated = await updatePlaylist(id, updateData);
    return NextResponse.json(updated);
  } catch (e) {
    if (isPlaylistPersistError(e)) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[api/playlists/refresh-view-count] error:", e);
    return NextResponse.json({ error: "Failed to update playlist" }, { status: 500 });
  }
}
