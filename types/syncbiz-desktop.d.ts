/**
 * Minimal Window typing for the Electron preload bridge (`desktop/src/preload`).
 * The web app stays independent of the `desktop/` package (excluded from tsconfig).
 */
type DesktopLocalMockCommand =
  | "PLAY"
  | "PAUSE"
  | "STOP"
  | "SET_VOLUME"
  | "PREV"
  | "NEXT";

type DesktopLocalMockPayload = {
  command: DesktopLocalMockCommand;
  volume?: number;
};

type ScanLocalAudioFolderIpcResult =
  | { status: "ok"; playlistName: string; files: string[] }
  | { status: "not_directory" }
  | { status: "error"; message: string };

type DesktopAutoStartState = {
  enabled: boolean;
  supported: boolean;
};

type DesktopMusicFolderSnapshot = {
  path: string | null;
};

type DesktopPickMusicFolderResult =
  | { status: "ok"; path: string }
  | { status: "canceled" }
  | { status: "error"; message: string };

type DesktopListMusicLibrarySnapshotTags = {
  artist: string | null;
  title: string | null;
  genre: string | null;
  year: string | null;
  album: string | null;
  durationSec: number | null;
};

type DesktopListMusicLibraryFileEntry = {
  name: string;
  path: string;
  snapshotTags?: DesktopListMusicLibrarySnapshotTags;
};

type ListMusicLibraryDirIpcResult =
  | { status: "ok"; dirs: { name: string; path: string }[]; files: DesktopListMusicLibraryFileEntry[] }
  | { status: "error"; message: string }
  | { status: "no_root" };

type GetLocalAudioCoverIpcResult =
  | { status: "ok"; dataUrl: string | null }
  | { status: "error"; message: string };

type LocalAudioTagFieldsIpc = {
  artist: string | null;
  title: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
  durationSec: number | null;
  bpm: number | null;
  rating: number | null;
};

type GetLocalAudioTagsIpcResult =
  | { status: "ok"; tags: LocalAudioTagFieldsIpc }
  | { status: "error"; message: string };

type InspectLocalAudioTagsRawIpcPayload = {
  filePath: string;
  artist: string | null;
  artists: string[] | null;
  title: string | null;
  genre: string | string[] | null;
  year: number | null;
  date: string | null;
  titleFallbackUsed: boolean;
};

type InspectLocalAudioTagsRawIpcResult =
  | { status: "ok"; payload: InspectLocalAudioTagsRawIpcPayload }
  | { status: "error"; message: string };

type LocalCollectionSearchHitIpc = {
  localId: string;
  absolutePath: string;
  relativePathFromRoot: string;
  artist: string | null;
  title: string | null;
  genre: string | null;
  year: string | null;
  album: string | null;
  durationSec: number | null;
  score: number;
};

type SearchLocalCollectionSnapshotIpcResult =
  | { status: "ok"; hits: LocalCollectionSearchHitIpc[] }
  | { status: "error"; message: string };

type ImportLocalM3uUnresolvedReasonIpc =
  | "missing"
  | "not_audio"
  | "outside_root"
  | "remote_url"
  | "invalid_path";

type ImportLocalM3uPlaylistIpcResult =
  | {
      status: "ok";
      playlistName: string;
      files: string[];
      trackDisplayNames: string[];
      imported: number;
      unresolved: Array<{ ref: string; reason: ImportLocalM3uUnresolvedReasonIpc }>;
      skipped: number;
    }
  | { status: "error"; message: string };

type SyncBizDesktopBridgePreload = {
  getConfig: () => Promise<{ deviceId: string }>;
  localMockTransport: (payload: DesktopLocalMockPayload) => Promise<unknown>;
  /** Optional: folder scan (full Desktop preload). */
  scanLocalAudioFolder?: (dir: string) => Promise<ScanLocalAudioFolderIpcResult>;
  /** Optional: native path for a dropped `File` (Electron webUtils). */
  getPathForFile?: (file: File) => string;
  /** Optional: OS auto-start (login item) state. */
  getAutoStart?: () => Promise<DesktopAutoStartState>;
  setAutoStart?: (enabled: boolean) => Promise<DesktopAutoStartState>;
  /** Optional: persisted music folder path. */
  getMusicFolder?: () => Promise<DesktopMusicFolderSnapshot>;
  pickMusicFolder?: () => Promise<DesktopPickMusicFolderResult>;
  clearMusicFolder?: () => Promise<DesktopMusicFolderSnapshot>;
  /** One-level browse under the configured music folder (Desktop preload with list IPC). */
  listMusicLibraryDir?: (subPath: string) => Promise<ListMusicLibraryDirIpcResult>;
  /** Embedded cover art (`data:image/...`) or null from main-process parse. */
  getLocalAudioCover?: (absolutePath: string) => Promise<GetLocalAudioCoverIpcResult>;
  /** Lazily-loaded tag snapshot for browse rows (Desktop main process only). */
  getLocalAudioTags?: (absolutePath: string) => Promise<GetLocalAudioTagsIpcResult>;
  /** Dev inspector — returns raw common.* values; logs once in main on each call. */
  inspectLocalAudioTagsRaw?: (absolutePath: string) => Promise<InspectLocalAudioTagsRawIpcResult>;
  /** Stage 4C: search persisted local collection snapshot in main (no folder walk during search). */
  searchLocalCollectionSnapshot?: (query: string, limit?: number) => Promise<SearchLocalCollectionSnapshotIpcResult>;
  /** Stage 5B: M3U/M3U8 → resolved paths under Music Folder (+ snapshot refresh in main). */
  importLocalM3uPlaylist?: (absolutePath: string) => Promise<ImportLocalM3uPlaylistIpcResult>;
};

declare global {
  interface Window {
    syncbizDesktop?: SyncBizDesktopBridgePreload;
  }
}

export {};
