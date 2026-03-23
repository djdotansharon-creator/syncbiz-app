/** Playlist source type for embedded or local playback. */
export type PlaylistType = "soundcloud" | "youtube" | "spotify" | "winamp" | "local" | "stream-url";

/** Single track in a playlist. */
export type PlaylistTrack = {
  id: string;
  name: string;
  title?: string; // alias for name, for JSON compatibility
  type: PlaylistType;
  url: string;
  cover?: string;
};

export type Playlist = {
  id: string;
  name: string;
  genre: string;
  type: PlaylistType;
  url: string;
  thumbnail: string;
  /** Alias for thumbnail; used in JSON storage format. */
  cover?: string;
  createdAt: string;
  /** Branch ownership. Legacy records may lack this; resolved as "default". */
  branchId?: string;
  /** View count (from YouTube etc.) – stored when adding from search. */
  viewCount?: number;
  /** Duration in seconds (from YouTube etc.) – stored when adding/refreshing. */
  durationSeconds?: number;
  /** Optional tracks array. If present, playlist has multiple tracks. */
  tracks?: PlaylistTrack[];
  /** Order of track IDs for drag-drop reorder. */
  order?: string[];
};

export type PlaylistCreateInput = Omit<Playlist, "id" | "createdAt"> & { id?: string };

/** Get effective tracks for a playlist (tracks array or legacy single URL). */
export function getPlaylistTracks(p: Playlist): PlaylistTrack[] {
  if (p.tracks && p.tracks.length > 0) {
    const order = p.order ?? p.tracks.map((t) => t.id);
    return order
      .map((id) => p.tracks!.find((t) => t.id === id))
      .filter((t): t is PlaylistTrack => !!t)
      .map((t) => ({
        ...t,
        name: t.name || (t as PlaylistTrack & { title?: string }).title || "Untitled",
      }));
  }
  return [
    {
      id: p.id,
      name: p.name,
      type: p.type,
      url: p.url,
      cover: p.thumbnail || undefined,
    },
  ];
}
