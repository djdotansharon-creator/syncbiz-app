/**
 * "A song's length is remembered the first time it plays" (owner 2026-11-26: "I can still stretch a song longer than its length ... it is as if it is not saved ... this cannot happen again").
 * The Schedules page stops a block at the length of its music, but only when that length is KNOWN; a song whose length could not be looked up stretched freely. The player knows the real length
 * the moment the song plays, so a window that sees it (the station's own status, mirrored) hands the number to the server once: `POST /api/playlists/:id/track-durations` (numbers keyed by track id,
 * never a path or an address; a length that is already known is never overwritten, the playlist's total follows only when every song is known). PURE: no network, no state.
 */

/** the shortest / longest length worth remembering: a jingle or a stream announcement is not a song, a live stream has no end */
export const LEARN_MIN_SECONDS = 15;
export const LEARN_MAX_SECONDS = 4 * 3600;
/** the song must have been playing this long, so a placeholder length that the player shows while it loads is never taken for the real one */
export const LEARN_MIN_POSITION = 5;

export type LearnState = {
  status?: string;
  duration?: number;
  position?: number;
  currentTrackIndex?: number;
  sessionPlaylistId?: string | null;
  sessionTracks?: Array<{ id: string; durationSeconds?: number | null }>;
} | null | undefined;

export type LearnTarget = { playlistId: string; trackId: string; seconds: number };

/** what could be remembered right now, or null (nothing playing, no saved playlist behind it, the song's length is already known, or the number is not believable) */
export function learnTargetOf(s: LearnState): LearnTarget | null {
  if (!s || s.status !== "playing") return null;
  const playlistId = typeof s.sessionPlaylistId === "string" ? s.sessionPlaylistId.trim() : "";
  if (!playlistId) return null;
  const idx = typeof s.currentTrackIndex === "number" && Number.isInteger(s.currentTrackIndex) && s.currentTrackIndex >= 0 ? s.currentTrackIndex : -1;
  const track = idx >= 0 ? s.sessionTracks?.[idx] : undefined;
  if (!track || typeof track.id !== "string" || !track.id) return null;
  if (typeof track.durationSeconds === "number" && track.durationSeconds > 0) return null; // already known: never overwritten
  const d = s.duration;
  if (typeof d !== "number" || !Number.isFinite(d) || d < LEARN_MIN_SECONDS || d > LEARN_MAX_SECONDS) return null;
  const p = s.position;
  if (typeof p !== "number" || !Number.isFinite(p) || p < LEARN_MIN_POSITION || p > d + 2) return null;
  return { playlistId, trackId: track.id, seconds: Math.round(d) };
}

/** the same song and the same length (within a second) seen twice: only then is it remembered */
export function sameSample(a: LearnTarget | null, b: LearnTarget | null): boolean {
  return !!a && !!b && a.playlistId === b.playlistId && a.trackId === b.trackId && Math.abs(a.seconds - b.seconds) <= 1;
}
