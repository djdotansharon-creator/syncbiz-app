/**
 * Preload — narrow `contextBridge` API for Desktop MVP (config + WS control + status stream).
 */
import { contextBridge, ipcRenderer } from "electron";
import type {
  BranchLibraryItem,
  BranchLibrarySummary,
  DesktopRuntimeConfig,
  DesktopSignInResult,
  LocalMockTransportPayload,
  MvpConfigPatch,
  MvpStatusSnapshot,
} from "../shared/mvp-types";
import { MVP_IPC } from "../shared/mvp-types";
import type { SyncBizDesktopMvp } from "../shared/mvp-desktop-api";

console.log("[SyncBiz desktop] preload: loading");

const api: SyncBizDesktopMvp = {
  getConfig: () => ipcRenderer.invoke(MVP_IPC.GET_CONFIG),
  getStatus: () => ipcRenderer.invoke(MVP_IPC.GET_STATUS),
  saveConfig: (patch) => ipcRenderer.invoke(MVP_IPC.SAVE_CONFIG, patch),
  connectCloud: () => ipcRenderer.invoke(MVP_IPC.WS_CONNECT),
  disconnectCloud: () => ipcRenderer.invoke(MVP_IPC.WS_DISCONNECT),
  fetchBranchLibrary: (): Promise<BranchLibrarySummary> =>
    ipcRenderer.invoke(MVP_IPC.FETCH_BRANCH_LIBRARY),
  selectStationSource: (item: BranchLibraryItem): Promise<MvpStatusSnapshot> =>
    ipcRenderer.invoke(MVP_IPC.SELECT_STATION_SOURCE, item),
  localMockTransport: (payload: LocalMockTransportPayload): Promise<MvpStatusSnapshot> =>
    ipcRenderer.invoke(MVP_IPC.LOCAL_MOCK_TRANSPORT, payload),
  signInWithPassword: (email: string, password: string): Promise<DesktopSignInResult> =>
    ipcRenderer.invoke(MVP_IPC.DESKTOP_SIGN_IN, { email, password }),
  onStatus: (callback) => {
    const handler = (_: unknown, status: MvpStatusSnapshot) => {
      callback(status);
    };
    ipcRenderer.on(MVP_IPC.STATUS, handler);
    return () => {
      ipcRenderer.removeListener(MVP_IPC.STATUS, handler);
    };
  },
};

contextBridge.exposeInMainWorld("syncbizDesktop", api);

console.log("[SyncBiz desktop] preload: syncbizDesktop API exposed");
