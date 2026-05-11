/**
 * MVP desktop — shared types for IPC and status (main ↔ preload ↔ renderer).
 */

export const MVP_IPC = {
  GET_CONFIG: "mvp:get-config",
  GET_STATUS: "mvp:get-status",
  SAVE_CONFIG: "mvp:save-config",
  WS_CONNECT: "mvp:ws-connect",
  WS_DISCONNECT: "mvp:ws-disconnect",
  FETCH_BRANCH_LIBRARY: "mvp:fetch-branch-library",
  SELECT_STATION_SOURCE: "mvp:select-station-source",
  LOCAL_MOCK_TRANSPORT: "mvp:local-mock-transport",
  DESKTOP_SIGN_IN: "mvp:desktop-sign-in",
  STATUS: "mvp:status",
  MPV_PLAY_URL: "mvp:mpv-play-url",
  MPV_PLAY_INTERRUPT: "mvp:mpv-play-interrupt",
  SET_DUCK_PERCENT: "mvp:set-duck-percent",
  MPV_SEEK_TO: "mvp:mpv-seek-to",
  /** Main process: list audio files in a directory (Desktop only). */
  SCAN_LOCAL_AUDIO_FOLDER: "mvp:scan-local-audio-folder",
  /** Read OS login-item state via app.getLoginItemSettings. */
  GET_AUTOSTART: "mvp:get-autostart",
  /** Write OS login-item state via app.setLoginItemSettings. */
  SET_AUTOSTART: "mvp:set-autostart",
  /** Read persisted music folder path. */
  GET_MUSIC_FOLDER: "mvp:get-music-folder",
  /** Open native folder picker; persist + return chosen path. */
  PICK_MUSIC_FOLDER: "mvp:pick-music-folder",
  /** Clear persisted music folder path. */
  CLEAR_MUSIC_FOLDER: "mvp:clear-music-folder",
  /** Non-recursive listing under the saved music folder (single directory level). */
  LIST_MUSIC_LIBRARY_DIR: "mvp:list-music-library-dir",
  /** First embedded picture from an audio file as a data URL, or null. */
  GET_LOCAL_AUDIO_COVER: "mvp:get-local-audio-cover",
  /** Common tags + duration from an audio file (main process only). */
  GET_LOCAL_AUDIO_TAGS: "mvp:get-local-audio-tags",
  /** Dev-only inspector: return raw common.* values and log once in main. */
  INSPECT_LOCAL_AUDIO_TAGS_RAW: "mvp:inspect-local-audio-tags-raw",
  /** Stage 4C: search local collection snapshot JSON in main only (metadata; no disk walk). */
  SEARCH_LOCAL_COLLECTION_SNAPSHOT: "mvp:search-local-collection-snapshot",
  /** Stage 5B: parse M3U/M3U8/PLS paths under Music Folder; refresh snapshot; returns paths for POST /api/playlists. */
  IMPORT_LOCAL_M3U_PLAYLIST: "mvp:import-local-m3u-playlist",
} as const;

/** Why a playlist line was not imported (V1: Music Folder + scan-local audio ext only). */
export type ImportLocalM3uUnresolvedReason =
  | "missing"
  | "not_audio"
  | "outside_root"
  | "remote_url"
  | "invalid_path";

/**
 * One playlist entry that could not be resolved to a local audio file under the Music Folder.
 * Stage 5C-A: enriched for future YouTube search (no search in this stage).
 */
export type ImportLocalM3uUnresolvedEntry = {
  /** Original path/URL line from the playlist (capped for IPC size). */
  ref: string;
  reason: ImportLocalM3uUnresolvedReason;
  /** 0-based position among all track entries processed in playlist file order. */
  playlistOrder: number;
  /** `#EXTINF` title after the comma, or PLS `TitleN=`, when present. */
  displayTitle: string | null;
  /** Seconds from `#EXTINF` before the comma, or PLS `LengthN=`, when known and positive. */
  durationSec: number | null;
  /** Best-effort query string for a future YouTube search (title, else path/filename, else ref). */
  suggestedSearchQuery: string;
};

export type ImportLocalM3uPlaylistResult =
  | {
      status: "ok";
      playlistName: string;
      files: string[];
      /** Parallel to files; from #EXTINF when present, else derived filename. */
      trackDisplayNames: string[];
      imported: number;
      unresolved: ImportLocalM3uUnresolvedEntry[];
      skipped: number;
    }
  | { status: "error"; message: string };

/** Result of scanning a folder for audio files (IPC from main). */
export type ScanLocalAudioFolderResult =
  | { status: "ok"; playlistName: string; files: string[] }
  | { status: "not_directory" }
  | { status: "error"; message: string };

/** Current login-item state from app.getLoginItemSettings. */
export type AutoStartState = {
  /** True if Electron will launch the app at OS login. */
  enabled: boolean;
  /** False on platforms where openAtLogin is unsupported (e.g. some Linux configs). */
  supported: boolean;
};

/** Result of the native music-folder picker. */
export type PickMusicFolderResult =
  | { status: "ok"; path: string }
  | { status: "canceled" }
  | { status: "error"; message: string };

/** Persisted music folder snapshot returned by GET_MUSIC_FOLDER / CLEAR_MUSIC_FOLDER. */
export type MusicFolderSnapshot = {
  path: string | null;
};

/** One audio file row from LIST_MUSIC_LIBRARY_DIR (Stage 4B: optional snapshot cache). */
export type ListMusicLibraryDirFileEntry = {
  name: string;
  path: string;
  /**
   * When the local collection snapshot has a row for this path and current size/mtime match,
   * main attaches the last-known tag fields (still refreshed via getLocalAudioTags in the UI).
   */
  snapshotTags?: {
    artist: string | null;
    title: string | null;
    genre: string | null;
    year: string | null;
    album: string | null;
    durationSec: number | null;
  };
};

/** Immediate children of one directory under the configured music root (Desktop only). */
export type ListMusicLibraryDirResult =
  | { status: "ok"; dirs: { name: string; path: string }[]; files: ListMusicLibraryDirFileEntry[] }
  | { status: "error"; message: string }
  | { status: "no_root" };

/** Stage 4C — one snapshot track match (metadata only; playback uses absolutePath on device). */
export type LocalCollectionSearchHit = {
  localId: string;
  absolutePath: string;
  relativePathFromRoot: string;
  artist: string | null;
  title: string | null;
  genre: string | null;
  year: string | null;
  album: string | null;
  durationSec: number | null;
  /** Higher is a better token match (heuristic). */
  score: number;
};

export type SearchLocalCollectionSnapshotResult =
  | { status: "ok"; hits: LocalCollectionSearchHit[] }
  | { status: "error"; message: string };

/** Embedded artwork as data URL, or absent. */
export type GetLocalAudioCoverResult =
  | { status: "ok"; dataUrl: string | null }
  | { status: "error"; message: string };

/** Tags read locally for browse UI (no upload). Missing fields use null. */
export type LocalAudioTagFields = {
  artist: string | null;
  title: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
  /** Seconds from container; null when unknown. */
  durationSec: number | null;
  /** BPM only when present in tags (no audio analysis). */
  bpm: number | null;
  /** Star rating 0–5 (averaged across rating sources); null when absent. */
  rating: number | null;
};

export type GetLocalAudioTagsResult =
  | { status: "ok"; tags: LocalAudioTagFields }
  | { status: "error"; message: string };

/**
 * Dev-only payload exposing the raw `common.*` values used by the parser, plus
 * whether the displayed Title would fall back to the filename. Intended for
 * one-off inspection from the UI while diagnosing tag mismatches.
 */
export type InspectLocalAudioTagsRawPayload = {
  filePath: string;
  artist: string | null;
  artists: string[] | null;
  title: string | null;
  genre: string | string[] | null;
  year: number | null;
  date: string | null;
  /** True when display falls back to the filename (no usable title tag). */
  titleFallbackUsed: boolean;
};

export type InspectLocalAudioTagsRawResult =
  | { status: "ok"; payload: InspectLocalAudioTagsRawPayload }
  | { status: "error"; message: string };

/** Local mock console — same commands as remote WS COMMAND (no MPV). */
export type LocalMockTransportPayload = {
  command: "PLAY" | "PAUSE" | "STOP" | "SET_VOLUME" | "PREV" | "NEXT";
  volume?: number;
};

export type MvpConnectionState = "disconnected" | "connecting" | "connected" | "error";

/** Persisted local config (userData JSON). Pilot: token stored in plaintext. */
export type DesktopRuntimeConfig = {
  /** Stable device identity; required for WS REGISTER. */
  deviceId: string;
  /** Must match server ALLOWED_BRANCH_IDS (Phase 1: typically "default"). */
  branchId: string;
  /** Human label only (workspace name — not validated against API in MVP). */
  workspaceLabel: string;
  /**
   * Next.js app origin for HTTP API (e.g. http://localhost:3000).
   * Separate from `wsUrl` (SyncBiz WS server, often port 3001).
   */
  apiBaseUrl: string;
  /** WebSocket URL e.g. wss://host or ws://localhost:3001 */
  wsUrl: string;
  /**
   * Bearer token: long-lived `desktop_access` from POST /api/auth/desktop/token, or short `ws_register`
   * from GET /api/auth/ws-token (paste). Same field is used for HTTP and WS REGISTER.
   */
  wsToken: string;
  /** Last email used with Sign in (optional, for form prefill). */
  lastAuthEmail?: string;
  /** ISO time when the current desktop bearer token expires (if known). */
  desktopTokenExpiresAtIso?: string;
  /** User-selected music folder for local file browsing (Desktop only). */
  musicFolderPath?: string;
};

export type DesktopSignInResult =
  | { ok: true; config: DesktopRuntimeConfig }
  | { ok: false; error: string };

/** One row from GET /api/sources/unified (branch scope), for desktop UI only. */
export type BranchLibraryItem = {
  id: string;
  title: string;
  origin: "playlist" | "radio" | "source";
  /** Provider hint: youtube, stream-url, etc. */
  type: string;
  branchId: string;
  genre: string;
  cover: string | null;
  /** Direct playback URL passed to MPV Channel A. Empty string when unavailable (e.g. multi-track playlist with no root URL). */
  url: string;
};

/** Read-only branch catalog snapshot (filtered by config branchId). */
export type BranchLibrarySummary = {
  status: "idle" | "ok" | "error";
  branchId?: string;
  playlistCount?: number;
  radioCount?: number;
  sourceCount?: number;
  samplePlaylistNames?: string[];
  /** Full branch-scoped list (when status is ok). */
  items?: BranchLibraryItem[];
  loadedAtIso?: string | null;
  errorMessage?: string | null;
};

/** From server SET_DEVICE_MODE — COMMAND is routed to MASTER only. */
export type MvpDeviceRole = "MASTER" | "CONTROL" | "unknown";

export type MvpStatusSnapshot = {
  appReady: boolean;
  deviceId: string;
  branchId: string;
  workspaceLabel: string;
  wsUrl: string;
  /** Masked: show only last 8 chars when set */
  hasToken: boolean;
  wsState: MvpConnectionState;
  registered: boolean;
  /** Server-assigned mode (after REGISTER). */
  deviceRole: MvpDeviceRole;
  /** Registered, connected, and MASTER — remote COMMAND messages are delivered here. */
  commandReady: boolean;
  /** Mock/local playback until MPV — mirrors what we send in STATE_UPDATE when MASTER. */
  mockPlaybackStatus: "idle" | "playing" | "paused" | "stopped";
  mockVolume: number;
  mockCurrentSourceLabel: string;
  /** Local branch library selection (mock runtime). */
  mockSelectedLibraryId: string | null;
  mockSelectedLibraryKind: "playlist" | "radio" | "source" | null;
  /** Unified API provider type for selected source (e.g. youtube, stream-url). */
  mockSelectedSourceType: string | null;
  /** Cover URL for hero artwork (from `currentSource.cover`, https only in UI). */
  mockCurrentSourceCoverUrl: string | null;
  /** Items in main-process branch catalog (from last library fetch + selection fallback). Used for PREV/NEXT. */
  branchCatalogCount: number;
  /** 0-based index of current station source in `branchCatalog`, or null if unknown / empty. */
  branchCatalogIndex: number | null;
  lastServerMessageType: string | null;
  lastCommandSummary: string | null;
  lastError: string | null;
  /** true while Channel A is ducked by an active interrupt. */
  isDucked: boolean;
  /** Volume Channel A is held at while ducked (debug). */
  duckTargetVolume: number;
  /** Configurable duck depth 0–100 (% of masterVolume). */
  duckPercent: number;
  /** MPV Channel A playback position in seconds — single source of truth for desktop player UI. */
  mpvPosition: number;
  /** MPV Channel A track duration in seconds — 0 when no file is loaded. */
  mpvDuration: number;
  /** true when the music-channel mpv process is up and JSON IPC is connected. */
  mpvEngineReady: boolean;
  /** Last engine issue for the music channel (load, binary, IPC, process) — not optimistic. */
  mpvLastError: string | null;
};

export type MvpConfigPatch = Partial<Omit<DesktopRuntimeConfig, "deviceId">> & {
  deviceId?: string;
};
