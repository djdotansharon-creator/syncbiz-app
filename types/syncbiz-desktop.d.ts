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

type SyncBizDesktopBridgePreload = {
  getConfig: () => Promise<{ deviceId: string }>;
  localMockTransport: (payload: DesktopLocalMockPayload) => Promise<unknown>;
  /** Optional: folder scan (full Desktop preload). */
  scanLocalAudioFolder?: (dir: string) => Promise<ScanLocalAudioFolderIpcResult>;
  /** Optional: native path for a dropped `File` (Electron webUtils). */
  getPathForFile?: (file: File) => string;
};

declare global {
  interface Window {
    syncbizDesktop?: SyncBizDesktopBridgePreload;
  }
}

export {};
