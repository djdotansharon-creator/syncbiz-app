import { NextRequest, NextResponse } from "next/server";
import { getPlaylist } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, hasBranchAccess } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";

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
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const playlist = await getPlaylist(id);
  if (!playlist) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }
  const branchId = resolveMediaBranchId(playlist);
  if (!(await hasBranchAccess(user.id, branchId))) {
    return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
  }
  return NextResponse.json({ playlist, playUrl: playlist.url });
}
