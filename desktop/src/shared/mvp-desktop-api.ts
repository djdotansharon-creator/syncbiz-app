import type {
  BranchLibraryItem,
  BranchLibrarySummary,
  DesktopRuntimeConfig,
  DesktopSignInResult,
  LocalMockTransportPayload,
  MvpConfigPatch,
  MvpStatusSnapshot,
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
};
