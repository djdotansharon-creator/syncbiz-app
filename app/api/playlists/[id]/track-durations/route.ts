import { NextRequest, NextResponse } from "next/server";
import { getPlaylist, updatePlaylist, isPlaylistPersistError } from "@/lib/playlist-store";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { gatePlaylistAccess } from "@/lib/playlist-access";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { applyTrackDurations, playlistTotalSeconds, sanitizeTrackDurations, tracksMissingLength } from "@/lib/playlist-duration";

/**
 * Store the length of songs a STATION read from its own files (owner 2026-11-21: "every song from the computer must be saved with how long it is").
 * A local file's path never leaves its machine (CLAUDE.md §12), so what arrives here is only numbers keyed by track id: { durations: { "<trackId>": seconds } }.
 *   · only a song that has no length yet gets one — a length that is already known is never overwritten;
 *   · the playlist's total follows (the sum when every song is known, else unknown — never a partial sum);
 *   · a one-song playlist with no stored track list *is* the song (its track id is the playlist's id): its own total is set.
 * Same access rule as the playlist's own routes (PUT / refresh-duration). Replies { durationSeconds | null, applied, stillMissing } — never a path.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromCookies();
  const { id } = await params;
  const playlist = await getPlaylist(id);
  const g = await gatePlaylistAccess(user ?? null, playlist);
  if (!g.allow) return NextResponse.json({ error: g.message }, { status: g.httpStatus });
  if (!playlist) return NextResponse.json({ error: "Playlist not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const durations = sanitizeTrackDurations((body as { durations?: unknown } | null)?.durations);
  if (Object.keys(durations).length === 0) return NextResponse.json({ error: "durations is required (track id → seconds)" }, { status: 400 });

  const tracks = getPlaylistTracks(playlist);
  const explicitTracks = !!playlist.tracks && playlist.tracks.length > 0;

  try {
    if (!explicitTracks) {
      // a one-song playlist: the song's length is the playlist's own total
      const sec = durations[playlist.id];
      const already = typeof playlist.durationSeconds === "number" && playlist.durationSeconds > 0;
      if (!sec || already) return NextResponse.json({ durationSeconds: playlistTotalSeconds(tracks), applied: 0, stillMissing: tracksMissingLength(tracks).length });
      const updated = await updatePlaylist(id, { durationSeconds: sec });
      const after = updated ? getPlaylistTracks(updated) : tracks;
      return NextResponse.json({ durationSeconds: updated?.durationSeconds ?? sec, applied: 1, stillMissing: tracksMissingLength(after).length });
    }

    const { tracks: next, applied } = applyTrackDurations(tracks, durations);
    if (applied === 0) return NextResponse.json({ durationSeconds: playlistTotalSeconds(tracks), applied: 0, stillMissing: tracksMissingLength(tracks).length });
    const updated = await updatePlaylist(id, { tracks: next, order: playlist.order });
    const after = updated ? getPlaylistTracks(updated) : next;
    return NextResponse.json({ durationSeconds: playlistTotalSeconds(after), applied, stillMissing: tracksMissingLength(after).length });
  } catch (e) {
    if (isPlaylistPersistError(e)) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[api/playlists/track-durations] error:", e);
    return NextResponse.json({ error: "Failed to update playlist" }, { status: 500 });
  }
}
