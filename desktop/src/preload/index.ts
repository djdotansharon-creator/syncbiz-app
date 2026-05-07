/**
 * Preload — narrow `contextBridge` API for Desktop MVP (config + WS control + status stream).
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
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
  InspectLocalAudioTagsRawResult,
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
  mpvPlayUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke(MVP_IPC.MPV_PLAY_URL, url),
  mpvPlayInterrupt: (url: string): Promise<void> =>
    ipcRenderer.invoke(MVP_IPC.MPV_PLAY_INTERRUPT, url),
  setDuckPercent: (n: number): Promise<void> =>
    ipcRenderer.invoke(MVP_IPC.SET_DUCK_PERCENT, n),
  mpvSeekTo: (seconds: number): Promise<void> =>
    ipcRenderer.invoke(MVP_IPC.MPV_SEEK_TO, seconds),
  scanLocalAudioFolder: (dir: string): Promise<ScanLocalAudioFolderResult> =>
    ipcRenderer.invoke(MVP_IPC.SCAN_LOCAL_AUDIO_FOLDER, dir),
  /** Prefer over deprecated `File.path` for native paths from file inputs and drag/drop. */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  getAutoStart: (): Promise<AutoStartState> => ipcRenderer.invoke(MVP_IPC.GET_AUTOSTART),
  setAutoStart: (enabled: boolean): Promise<AutoStartState> =>
    ipcRenderer.invoke(MVP_IPC.SET_AUTOSTART, enabled),
  getMusicFolder: (): Promise<MusicFolderSnapshot> => ipcRenderer.invoke(MVP_IPC.GET_MUSIC_FOLDER),
  pickMusicFolder: (): Promise<PickMusicFolderResult> => ipcRenderer.invoke(MVP_IPC.PICK_MUSIC_FOLDER),
  clearMusicFolder: (): Promise<MusicFolderSnapshot> => ipcRenderer.invoke(MVP_IPC.CLEAR_MUSIC_FOLDER),
  listMusicLibraryDir: (subPath: string): Promise<ListMusicLibraryDirResult> =>
    ipcRenderer.invoke(MVP_IPC.LIST_MUSIC_LIBRARY_DIR, subPath),
  getLocalAudioCover: (absolutePath: string): Promise<GetLocalAudioCoverResult> =>
    ipcRenderer.invoke(MVP_IPC.GET_LOCAL_AUDIO_COVER, absolutePath),
  getLocalAudioTags: (absolutePath: string): Promise<GetLocalAudioTagsResult> =>
    ipcRenderer.invoke(MVP_IPC.GET_LOCAL_AUDIO_TAGS, absolutePath),
  inspectLocalAudioTagsRaw: (absolutePath: string): Promise<InspectLocalAudioTagsRawResult> =>
    ipcRenderer.invoke(MVP_IPC.INSPECT_LOCAL_AUDIO_TAGS_RAW, absolutePath),
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
