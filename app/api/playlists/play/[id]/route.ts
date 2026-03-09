import { NextRequest, NextResponse } from "next/server";
import { getPlaylist } from "@/lib/playlist-store";

/**
 * POST /api/playlists/play/:id
 * Returns playlist data for the client to open in embedded player or launch locally.
 * The client decides: YouTube/SoundCloud/stream-url → embedded; local → play-local.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const playlist = await getPlaylist(id);
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }
  return NextResponse.json({ playlist, playUrl: playlist.url });
}
