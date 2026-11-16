import { NextRequest, NextResponse } from "next/server";
import { getPlaylist, updatePlaylist, isPlaylistPersistError } from "@/lib/playlist-store";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { gatePlaylistAccess } from "@/lib/playlist-access";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { resolveYouTubeMetadata } from "@/lib/youtube-metadata-resolver";
import { playlistTotalSeconds, tracksMissingLength } from "@/lib/playlist-duration";

/**
 * Learn the length of every YouTube song of a playlist that has none stored yet, store it on the song (PlaylistItem.durationSec) and refresh the playlist's total
 * (owner 2026-11-15: "every playlist must carry how long it takes"). Only what is looked up is changed; a song whose length cannot be looked up here (a local file —
 * its path never leaves its machine —, another provider, YouTube not reachable) stays unknown and the total stays unknown (never a partial sum).
 * Same access rule as the playlist's own routes. Replies { durationSeconds | null, resolved, stillMissing }.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromCookies();
  const { id } = await params;
  const playlist = await getPlaylist(id);
  const g = await gatePlaylistAccess(user ?? null, playlist);
  if (!g.allow) return NextResponse.json({ error: g.message }, { status: g.httpStatus });
  if (!playlist) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });

  const tracks = getPlaylistTracks(playlist);
  const missing = tracksMissingLength(tracks);
  if (missing.length === 0) {
    return NextResponse.json({ durationSeconds: playlistTotalSeconds(tracks), resolved: 0, stillMissing: 0 });
  }

  const found = new Map<string, number>();
  const queue = missing.filter((t) => t.type === "youtube" && !!getYouTubeVideoId(t.url));
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      try {
        const meta = await resolveYouTubeMetadata(t.url);
        if (meta && typeof meta.durationSeconds === "number" && meta.durationSeconds > 0) found.set(t.id, Math.round(meta.durationSeconds));
      } catch {
        /* this song stays unknown */
      }
    }
  });
  await Promise.all(workers);

  if (found.size === 0) {
    return NextResponse.json({ durationSeconds: playlistTotalSeconds(tracks), resolved: 0, stillMissing: missing.length });
  }
  try {
    const next = tracks.map((t) => (found.has(t.id) ? { ...t, durationSeconds: found.get(t.id)! } : t));
    const updated = await updatePlaylist(id, { tracks: next, order: playlist.order });
    const after = updated ? getPlaylistTracks(updated) : next;
    return NextResponse.json({ durationSeconds: playlistTotalSeconds(after), resolved: found.size, stillMissing: tracksMissingLength(after).length });
  } catch (e) {
    if (isPlaylistPersistError(e)) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[api/playlists/refresh-duration] error:", e);
    return NextResponse.json({ error: "Failed to update playlist" }, { status: 500 });
  }
}
