import { NextRequest, NextResponse } from "next/server";
import { getPlaylist } from "@/lib/playlist-store";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { gatePlaylistAccess } from "@/lib/playlist-access";

/**
 * POST /api/playlists/play/:id
 * Returns playlist data for the client to open in embedded player or launch locally.
 * The client decides: YouTube/SoundCloud/stream-url → embedded; local → play-local.
 */
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
  return NextResponse.json({ playlist: playlist!, playUrl: playlist!.url });
}
