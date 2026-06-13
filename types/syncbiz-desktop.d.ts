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
  displayLabel?: string | null;
  isPlaylistProLibrary?: boolean;
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

type LocalAiPlaylistCandidateIpc = {
  localId: string;
  absolutePath: string;
  relativePathFromRoot: string;
  artist: string | null;
  title: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
  durationSec: number | null;
  bpm: number | null;
  rating: number | null;
  score: number;
  matchDebug?: {
    groupsMatched: number;
    groupsTotal: number;
    fullMatch: boolean;
    score: number;
    reason: string;
    groups: Array<{ label: string; matched: boolean; terms: string[]; fields: string[] }>;
  };
};

type SearchLocalForAiPlaylistIpcResult =
  | { status: "ok"; candidates: LocalAiPlaylistCandidateIpc[] }
  | { status: "error"; message: string };

type ImportLocalM3uUnresolvedReasonIpc =
  | "missing"
  | "not_audio"
  | "outside_root"
  | "remote_url"
  | "invalid_path";

type ImportLocalM3uUnresolvedEntryIpc = {
  ref: string;
  reason: ImportLocalM3uUnresolvedReasonIpc;
  playlistOrder: number;
  displayTitle: string | null;
  durationSec: number | null;
  suggestedSearchQuery: string;
};

type ImportLocalM3uPlaylistIpcResult =
  | {
      status: "ok";
      playlistName: string;
      files: string[];
      resolvedSourceOrders: number[];
      trackDisplayNames: string[];
      imported: number;
      unresolved: ImportLocalM3uUnresolvedEntryIpc[];
      skipped: number;
    }
  | { status: "error"; message: string };

type PickTagRenameXlsxFilesIpcResult =
  | { status: "ok"; filePaths: string[] }
  | { status: "canceled" }
  | { status: "error"; message: string };

type LocalMetadataBankLastImportIpc = {
  folderPath: string;
  importedAt: string;
  filesScanned: number;
  filesProcessed: number;
  rowsRead: number;
  matched: number;
  updated: number;
  unmatched: number;
  outsideMusicFolder: number;
  missingOnDisk: number;
};

type LocalMetadataBankStatusIpcResult = {
  folderPath: string | null;
  lastImport: LocalMetadataBankLastImportIpc | null;
};

type PickLocalMetadataBankFolderIpcResult =
  | { status: "ok"; path: string }
  | { status: "canceled" }
  | { status: "error"; message: string };

type RefreshLocalMetadataBankIpcResult =
  | {
      status: "ok";
      folderPath: string;
      importedAt: string;
      filesScanned: number;
      filesProcessed: number;
      rowsRead: number;
      matched: number;
      updated: number;
      unmatched: number;
      outsideMusicFolder: number;
      missingOnDisk: number;
      sampleUnmatchedPaths: string[];
    }
  | { status: "error"; message: string };

type ImportTagRenameXlsxFilesIpcResult =
  | {
      status: "ok";
      filesProcessed: number;
      rowsRead: number;
      matched: number;
      updated: number;
      unmatched: number;
      outsideMusicFolder: number;
      missingOnDisk: number;
      sampleUnmatchedPaths: string[];
    }
  | { status: "error"; message: string };

type DesktopMusicLibrarySource = {
  id: string;
  kind: "playlistpro" | "additional";
  path: string;
  displayLabel: string;
  status: "ready" | "missing" | "unconfigured";
  trackCount: number | null;
  lastScanIso: string | null;
  removable: boolean;
};

type DesktopMusicLibrarySourcesResult = {
  playlistPro: DesktopMusicLibrarySource;
  additional: DesktopMusicLibrarySource[];
};

type DesktopAddAdditionalMusicFolderResult =
  | { status: "ok"; source: DesktopMusicLibrarySource }
  | { status: "canceled" }
  | { status: "already_added"; path: string }
  | { status: "protected"; reason: "playlistpro_root" }
  | { status: "error"; message: string };

type DesktopRemoveAdditionalMusicFolderResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "protected"; reason: "playlistpro_root" }
  | { status: "error"; message: string };

type DesktopScanMusicLibrarySummary = {
  path: string;
  kind: "playlistpro" | "additional";
  filesIndexed: number;
  errorMessage: string | null;
};

type DesktopScanMusicLibraryResult =
  | { status: "ok"; scannedAtIso: string; sources: DesktopScanMusicLibrarySummary[] }
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
  /**
   * Phase 1 hybrid AI playlist — return richer local snapshot candidates (with bpm/comment/rating)
   * for the renderer to forward to /api/playlists/ai-build as `additionalCandidates`. Browser without
   * Desktop bridge returns undefined → AI build stays catalog-only.
   */
  searchLocalForAiPlaylist?: (query: string, limit?: number) => Promise<SearchLocalForAiPlaylistIpcResult>;
  /** Stage 5B: M3U/M3U8 → resolved paths under Music Folder (+ snapshot refresh in main). */
  importLocalM3uPlaylist?: (absolutePath: string) => Promise<ImportLocalM3uPlaylistIpcResult>;
  /** Tag&Rename / PLP XLSX — native file picker (user metadata; device-local only). */
  pickTagRenameXlsxFiles?: () => Promise<PickTagRenameXlsxFilesIpcResult>;
  importTagRenameXlsxFiles?: (filePaths: string[]) => Promise<ImportTagRenameXlsxFilesIpcResult>;
  getLocalMetadataBank?: () => Promise<LocalMetadataBankStatusIpcResult>;
  pickLocalMetadataBankFolder?: () => Promise<PickLocalMetadataBankFolderIpcResult>;
  refreshLocalMetadataBank?: () => Promise<RefreshLocalMetadataBankIpcResult>;
  /** Pilot: protected PlaylistPro + user-added music folders (Winamp Watch Folders model). */
  listMusicLibrarySources?: () => Promise<DesktopMusicLibrarySourcesResult>;
  addAdditionalMusicFolder?: () => Promise<DesktopAddAdditionalMusicFolderResult>;
  removeAdditionalMusicFolder?: (folderPath: string) => Promise<DesktopRemoveAdditionalMusicFolderResult>;
  scanMusicLibrary?: () => Promise<DesktopScanMusicLibraryResult>;
};

declare global {
  interface Window {
    syncbizDesktop?: SyncBizDesktopBridgePreload;
  }
}

export {};
