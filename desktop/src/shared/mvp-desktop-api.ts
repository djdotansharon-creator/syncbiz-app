import type {
  AddAdditionalMusicFolderResult,
  AutoStartState,
  BranchLibraryItem,
  BranchLibrarySummary,
  DesktopRuntimeConfig,
  DesktopSignInResult,
  LocalMockTransportPayload,
  MusicFolderSnapshot,
  MusicLibrarySourcesResult,
  MvpConfigPatch,
  MvpStatusSnapshot,
  PickMusicFolderResult,
  RemoveAdditionalMusicFolderResult,
  ScanLocalAudioFolderResult,
  ScanMusicLibraryResult,
  ListMusicLibraryDirResult,
  GetLocalAudioCoverResult,
  GetLocalAudioTagsResult,
  InspectLocalAudioTagsRawResult,
  SearchLocalCollectionSnapshotResult,
  SearchLocalForAiPlaylistResult,
  ImportLocalM3uPlaylistResult,
  PickTagRenameXlsxFilesResult,
  ImportTagRenameXlsxFilesResult,
  LocalMetadataBankStatusResult,
  PickLocalMetadataBankFolderResult,
  RefreshLocalMetadataBankResult,
} from "./mvp-types";

/** Preload `contextBridge` contract (renderer uses `window.syncbizDesktop`). */
export type SyncBizDesktopMvp = {
  getConfig: () => Promise<DesktopRuntimeConfig>;
  getStatus: () => Promise<MvpStatusSnapshot>;
  /** Running desktop app SemVer (`app.getVersion()`), for the in-app update check. */
  getAppVersion: () => Promise<string>;
  saveConfig: (patch: MvpConfigPatch) => Promise<DesktopRuntimeConfig>;
  connectCloud: () => Promise<MvpStatusSnapshot>;
  disconnectCloud: () => Promise<MvpStatusSnapshot>;
  fetchBranchLibrary: () => Promise<BranchLibrarySummary>;
  selectStationSource: (item: BranchLibraryItem) => Promise<MvpStatusSnapshot>;
  localMockTransport: (payload: LocalMockTransportPayload) => Promise<MvpStatusSnapshot>;
  signInWithPassword: (email: string, password: string) => Promise<DesktopSignInResult>;
  onStatus: (callback: (status: MvpStatusSnapshot) => void) => () => void;
  /** Dev-only: load and play a URL or local file path on the music channel (no WS required). */
  mpvPlayUrl: (url: string) => Promise<void>;
  mpvPlayUrlCrossfade: (url: string, fadeSec: number) => Promise<void>;
  /** Push Settings mix duration to main-process orchestrator (desktop WS / MPV paths). */
  setMixDuration: (seconds: number) => Promise<void>;
  /** Dev-only: send a URL to the interrupt channel (triggers ducking). */
  mpvPlayInterrupt: (url: string) => Promise<void>;
  /** Set duck depth 0–100 (% of masterVolume Channel A falls to during interrupt). */
  setDuckPercent: (n: number) => Promise<void>;
  /** Seek MPV Channel A to an absolute position in seconds. */
  mpvSeekTo: (seconds: number) => Promise<void>;
  /** Desktop: list supported audio files in a directory (absolute paths for MPV). */
  scanLocalAudioFolder: (dir: string) => Promise<ScanLocalAudioFolderResult>;
  /** Native absolute path for a dropped/selected `File` (replaces deprecated `file.path` in modern Electron). */
  getPathForFile: (file: File) => string;
  /** Read the OS auto-start (login item) state for SyncBiz. */
  getAutoStart: () => Promise<AutoStartState>;
  /** Toggle the OS auto-start (login item) state for SyncBiz. */
  setAutoStart: (enabled: boolean) => Promise<AutoStartState>;
  /** Read the persisted music folder path (or null when unset). */
  getMusicFolder: () => Promise<MusicFolderSnapshot>;
  /** Open native folder picker; on confirm, persist + return chosen path. */
  pickMusicFolder: () => Promise<PickMusicFolderResult>;
  /** Clear the persisted music folder path. */
  clearMusicFolder: () => Promise<MusicFolderSnapshot>;
  /** List folders + supported audio files in one directory under the saved music root. */
  listMusicLibraryDir: (subPath: string) => Promise<ListMusicLibraryDirResult>;
  /** Embedded cover as `data:image/...;base64,...` or null. */
  getLocalAudioCover: (absolutePath: string) => Promise<GetLocalAudioCoverResult>;
  /** ID3/tag metadata for browse rows (lazy; desktop main process only). */
  getLocalAudioTags: (absolutePath: string) => Promise<GetLocalAudioTagsResult>;
  /** Dev inspector — returns raw common.* values; logs once in main on each call. */
  inspectLocalAudioTagsRaw: (absolutePath: string) => Promise<InspectLocalAudioTagsRawResult>;
  /** Stage 4C: search persisted local collection snapshot in main (no folder walk). */
  searchLocalCollectionSnapshot: (query: string, limit?: number) => Promise<SearchLocalCollectionSnapshotResult>;
  /**
   * Phase 1 hybrid AI playlist — return richer local snapshot candidates (with bpm/comment/rating)
   * for the renderer to forward to /api/playlists/ai-build as `additionalCandidates`.
   */
  searchLocalForAiPlaylist: (query: string, limit?: number) => Promise<SearchLocalForAiPlaylistResult>;
  /** Stage 5B: parse M3U/M3U8; returns resolved paths under Music Folder for library POST. */
  importLocalM3uPlaylist: (absolutePath: string) => Promise<ImportLocalM3uPlaylistResult>;
  /** Open file picker for Tag&Rename / PLP XLSX (user metadata; never uploaded). */
  pickTagRenameXlsxFiles: () => Promise<PickTagRenameXlsxFilesResult>;
  /** Parse selected XLSX files; match rows by File Name (absolute path) → snapshot tags. */
  importTagRenameXlsxFiles: (filePaths: string[]) => Promise<ImportTagRenameXlsxFilesResult>;
  getLocalMetadataBank: () => Promise<LocalMetadataBankStatusResult>;
  pickLocalMetadataBankFolder: () => Promise<PickLocalMetadataBankFolderResult>;
  refreshLocalMetadataBank: () => Promise<RefreshLocalMetadataBankResult>;
  /**
   * Pilot: protected PlaylistPro + user-added music folders (Winamp Watch Folders model).
   * Normal users add/remove only additional folders — PlaylistPro stays protected.
   */
  listMusicLibrarySources: () => Promise<MusicLibrarySourcesResult>;
  addAdditionalMusicFolder: () => Promise<AddAdditionalMusicFolderResult>;
  removeAdditionalMusicFolder: (folderPath: string) => Promise<RemoveAdditionalMusicFolderResult>;
  scanMusicLibrary: () => Promise<ScanMusicLibraryResult>;
};
