import { NextRequest, NextResponse } from "next/server";
import { getPlaylist, updatePlaylist } from "@/lib/playlist-store";
import { getCurrentUserFromCookies, hasBranchAccess } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { resolveYouTubeMetadata } from "@/lib/youtube-metadata-resolver";

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
  if ((playlist.tenantId && playlist.tenantId !== user.tenantId) || (!playlist.tenantId && user.tenantId !== "tnt-default")) {
    return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
  }
  const branchId = resolveMediaBranchId(playlist);
  if (!(await hasBranchAccess(user.id, branchId))) {
    return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
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
