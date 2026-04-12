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
};
