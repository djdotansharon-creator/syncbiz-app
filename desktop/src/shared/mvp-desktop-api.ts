import type {
  AutoStartState,
  BranchLibraryItem,
  BranchLibrarySummary,
  DesktopRuntimeConfig,
  DesktopSignInResult,
  LocalMockTransportPayload,
  MusicFolderSnapshot,
  MvpConfigPatch,
  MvpStatusSnapshot,
  PickMusicFolderResult,
  ScanLocalAudioFolderResult,
  ListMusicLibraryDirResult,
  GetLocalAudioCoverResult,
  GetLocalAudioTagsResult,
} from "./mvp-types";

/** Preload `contextBridge` contract (renderer uses `window.syncbizDesktop`). */
export type SyncBizDesktopMvp = {
  getConfig: () => Promise<DesktopRuntimeConfig>;
  getStatus: () => Promise<MvpStatusSnapshot>;
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
};
