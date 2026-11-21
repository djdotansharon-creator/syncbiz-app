/**
 * PLAYLIST LENGTH (owner 2026-11-15: "every playlist must carry how long it takes — that is the whole business"). Pure (no database), shared by the store, the API and the tests.
 *   · a track's own length lives on the track (`durationSeconds`, stored in PlaylistItem.durationSec); null / 0 / missing = not known yet;
 *   · the playlist's total (`Playlist.durationSeconds`) is the SUM when every track is known; with a missing track it is not known (never a partial sum — a wrong length
 *     is worse than none, the schedule would stretch / cut the music by it);
 *   · a one-song playlist IS the song: its total and its track's length are the same number.
 */

export type TrackLike = { durationSeconds?: number | null };

const known = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** the sum of the tracks' lengths, or null when any track's length is not known (or there are no tracks) */
export function playlistTotalSeconds(tracks: readonly TrackLike[] | undefined | null): number | null {
  if (!tracks || tracks.length === 0) return null;
  let sum = 0;
  for (const t of tracks) {
    if (!known(t.durationSeconds)) return null;
    sum += Math.round(t.durationSeconds);
  }
  return sum > 0 ? sum : null;
}

/** a one-song playlist hands its own length to its song when the song has none (the playlist *is* the song); longer lists are returned unchanged */
export function withSingleTrackLength<T extends TrackLike>(tracks: readonly T[], playlistSeconds: number | null | undefined): T[] {
  if (tracks.length === 1 && !known(tracks[0]!.durationSeconds) && known(playlistSeconds)) return [{ ...tracks[0]!, durationSeconds: Math.round(playlistSeconds) }];
  return [...tracks];
}

/** the total to store for a playlist whose tracks are `tracks`: the sum when every track is known, else the caller's own explicit figure for a one-song list, else null */
export function totalToStore(tracks: readonly TrackLike[], explicit: number | null | undefined): number | null {
  const sum = playlistTotalSeconds(tracks);
  if (sum !== null) return sum;
  return tracks.length <= 1 && known(explicit) ? Math.round(explicit) : null;
}

/** the tracks that still need their length looked up */
export function tracksMissingLength<T extends TrackLike>(tracks: readonly T[]): T[] {
  return tracks.filter((t) => !known(t.durationSeconds));
}

/**
 * LENGTHS A STATION READS FROM ITS OWN FILES (owner 2026-11-21: "every song from the computer must be saved with how long it is"). A local file's path never leaves its machine
 * (CLAUDE.md §12), so the station that owns the file reads its real length and reports ONLY numbers keyed by track id — never a path.
 */
export const MAX_REPORTED_TRACK_SECONDS = 12 * 3600;
export const MAX_REPORTED_TRACKS = 2000;

/** the lengths a client reports (track id → seconds): only whole, plausible figures are kept (1 second … 12 hours), at most {@link MAX_REPORTED_TRACKS} of them */
export function sanitizeTrackDurations(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let n = 0;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_REPORTED_TRACKS) break;
    if (!id || id.length > 200) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > MAX_REPORTED_TRACK_SECONDS) continue;
    out[id] = Math.round(v);
    n++;
  }
  return out;
}

/** put the reported lengths on the songs that have none yet — a length that is already known is never overwritten; `applied` = how many songs got one */
export function applyTrackDurations<T extends TrackLike & { id: string }>(tracks: readonly T[], durations: Readonly<Record<string, number>>): { tracks: T[]; applied: number } {
  let applied = 0;
  const next = tracks.map((t) => {
    const sec = durations[t.id];
    if (known(t.durationSeconds) || !known(sec)) return t;
    applied++;
    return { ...t, durationSeconds: Math.round(sec) };
  });
  return { tracks: next, applied };
}
