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
