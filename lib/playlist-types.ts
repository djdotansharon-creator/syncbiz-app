import {
  playlistMetadataRegistry,
  type MetadataEnergyLevelValue,
  type MetadataMoodValue,
  type MetadataPrimaryGenreValue,
  type MetadataSubGenreValue,
  type MetadataUseCaseValue,
} from "./playlist-metadata-registry";

/** Allowed use-case keys for playlist JSON (see `playlist-metadata-registry.ts` for labels). */
export type PlaylistUseCasePhase1 = MetadataUseCaseValue;
export const PLAYLIST_USE_CASES_PHASE1 = playlistMetadataRegistry.useCases.map(
  (o) => o.value,
) as readonly PlaylistUseCasePhase1[];

export type PlaylistPrimaryGenrePhase15 = MetadataPrimaryGenreValue;
export const PLAYLIST_PRIMARY_GENRES_PHASE15 = playlistMetadataRegistry.primaryGenres.map(
  (o) => o.value,
) as readonly PlaylistPrimaryGenrePhase15[];

export type PlaylistSubGenrePhase15 = MetadataSubGenreValue;
export const PLAYLIST_SUB_GENRES_PHASE15 = playlistMetadataRegistry.subGenres.map(
  (o) => o.value,
) as readonly PlaylistSubGenrePhase15[];

export type PlaylistMoodPhase15 = MetadataMoodValue;
export const PLAYLIST_MOODS_PHASE15 = playlistMetadataRegistry.moods.map(
  (o) => o.value,
) as readonly PlaylistMoodPhase15[];

export type PlaylistEnergyLevelPhase15 = MetadataEnergyLevelValue;
export const PLAYLIST_ENERGY_LEVELS_PHASE15 = playlistMetadataRegistry.energyLevels.map(
  (o) => o.value,
) as readonly PlaylistEnergyLevelPhase15[];

/** Playlist source type for embedded or local playback. */
export type PlaylistType = "soundcloud" | "youtube" | "spotify" | "winamp" | "local" | "stream-url";

/**
 * Library shell bucket for persisted playlists. Only `ready_external` is stored; omit for default
 * (Your Playlists / syncbiz_playlist contract).
 */
export type PlaylistLibraryPlacement = "ready_external";

/**
 * POST /api/playlists body only — not stored on `Playlist`. When present, the server sets
 * `libraryPlacement: "ready_external"` (Ready Playlists). Only the YouTube Mix Import save
 * flow should send this.
 */
export const PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT = "youtube_mix_import" as const;
export type PlaylistCreateSaveOrigin = typeof PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT;

/** Single track in a playlist. */
export type PlaylistTrack = {
  id: string;
  name: string;
  title?: string; // alias for name, for JSON compatibility
  type: PlaylistType;
  url: string;
  cover?: string;
  /** Optional link to catalog row for this track URL (Phase 1); playback still uses `url`. */
  catalogItemId?: string;
  /**
   * Duration of the track in seconds. Populated at runtime from yt-dlp / media metadata; may
   * already be on persisted tracks for sources that stored it. Absence means "unknown" —
   * callers should show "—" rather than treating missing as zero.
   */
  durationSeconds?: number;
};

/** Contributor sections for composite scheduled playlists (persisted JSON). */
export type ScheduleContributorBlock = {
  id: string;
  kind: "playlist" | "direct";
  label: string;
  /** When kind === "playlist", the library container key (e.g. syncbiz:uuid). */
  sourcePlaylistKey?: string;
  trackIds: string[];
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
  /**
   * Branch-shared playlists vs OWNER-only personal bank (mobile personal player).
   * Omitted/undefined = branch catalog (existing behavior).
   */
  playlistOwnershipScope?: "branch" | "owner_personal";
  /** Branch ownership. Legacy records may lack this; resolved as "default". */
  branchId?: string;
  /** Workspace/account ownership. */
  tenantId?: string;
  /** Optional link to centralized catalog row (Phase 1); playback still uses `url` / tracks. */
  catalogItemId?: string;
  /** View count (from YouTube etc.) – stored when adding from search. */
  viewCount?: number;
  /** Duration in seconds (from YouTube etc.) – stored when adding/refreshing. */
  durationSeconds?: number;
  /** Optional tracks array. If present, playlist has multiple tracks. */
  tracks?: PlaylistTrack[];
  /** Order of track IDs for drag-drop reorder. */
  order?: string[];
  /** Free-form notes (not used for playback). */
  adminNotes?: string;
  /** Legacy single use-case key; prefer `useCases` when set. */
  useCase?: PlaylistUseCasePhase1;
  /** Multiple use-case tags (same vocabulary as `useCase`). */
  useCases?: PlaylistUseCasePhase1[];
  primaryGenre?: PlaylistPrimaryGenrePhase15;
  subGenres?: PlaylistSubGenrePhase15[];
  mood?: PlaylistMoodPhase15;
  energyLevel?: PlaylistEnergyLevelPhase15;
  /** When set, unified library classifies as external_playlist (Ready/external path), not Your Playlists. */
  libraryPlacement?: PlaylistLibraryPlacement;
  /**
   * Optional composite “scheduled playlist” metadata: contributor blocks (source playlists or direct adds)
   * whose leaf `trackIds` partition (or cover) persisted `tracks`. Playback still uses `tracks` + `order` only.
   */
  scheduleContributorBlocks?: ScheduleContributorBlock[];
};

/** Effective use cases: prefer `useCases` when non-empty; else legacy single `useCase`. */
export function effectivePlaylistUseCases(p: Pick<Playlist, "useCases" | "useCase">): PlaylistUseCasePhase1[] {
  if (p.useCases && p.useCases.length > 0) return [...p.useCases];
  if (p.useCase) return [p.useCase];
  return [];
}

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
      // Single-track fallback: the playlist *is* the track, so pass through its duration
      // rather than stripping it. Fixes the Live Queue showing "—" for single-video drops.
      ...(typeof p.durationSeconds === "number" && p.durationSeconds >= 0
        ? { durationSeconds: p.durationSeconds }
        : {}),
    },
  ];
}
