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

type ListMusicLibraryDirIpcResult =
  | { status: "ok"; dirs: { name: string; path: string }[]; files: { name: string; path: string }[] }
  | { status: "error"; message: string }
  | { status: "no_root" };

type GetLocalAudioCoverIpcResult =
  | { status: "ok"; dataUrl: string | null }
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
};

declare global {
  interface Window {
    syncbizDesktop?: SyncBizDesktopBridgePreload;
  }
}

export {};
