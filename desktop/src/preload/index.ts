/**
 * Preload — narrow `contextBridge` API for Desktop MVP (config + WS control + status stream).
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
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
  WhatsAppStatus,
  WhatsAppBounds,
} from "../shared/mvp-types";
import { MVP_IPC } from "../shared/mvp-types";
import type { SyncBizDesktopMvp } from "../shared/mvp-desktop-api";

console.log("[SyncBiz desktop] preload: loading");

const api: SyncBizDesktopMvp = {
  getConfig: () => ipcRenderer.invoke(MVP_IPC.GET_CONFIG),
  getStatus: () => ipcRenderer.invoke(MVP_IPC.GET_STATUS),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(MVP_IPC.GET_APP_VERSION),
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
  mpvPlayUrlCrossfade: (url: string, fadeSec: number): Promise<void> =>
    ipcRenderer.invoke(MVP_IPC.MPV_PLAY_URL_CROSSFADE, { url, fadeSec }),
  setMixDuration: (seconds: number): Promise<void> =>
    ipcRenderer.invoke(MVP_IPC.SET_MIX_DURATION, seconds),
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
  searchLocalCollectionSnapshot: (query: string, limit?: number): Promise<SearchLocalCollectionSnapshotResult> =>
    ipcRenderer.invoke(MVP_IPC.SEARCH_LOCAL_COLLECTION_SNAPSHOT, query, limit),
  searchLocalForAiPlaylist: (query: string, limit?: number): Promise<SearchLocalForAiPlaylistResult> =>
    ipcRenderer.invoke(MVP_IPC.SEARCH_LOCAL_FOR_AI_PLAYLIST, query, limit),
  importLocalM3uPlaylist: (absolutePath: string): Promise<ImportLocalM3uPlaylistResult> =>
    ipcRenderer.invoke(MVP_IPC.IMPORT_LOCAL_M3U_PLAYLIST, absolutePath),
  pickTagRenameXlsxFiles: (): Promise<PickTagRenameXlsxFilesResult> =>
    ipcRenderer.invoke(MVP_IPC.PICK_TAG_RENAME_XLSX_FILES),
  importTagRenameXlsxFiles: (filePaths: string[]): Promise<ImportTagRenameXlsxFilesResult> =>
    ipcRenderer.invoke(MVP_IPC.IMPORT_TAG_RENAME_XLSX_FILES, filePaths),
  getLocalMetadataBank: (): Promise<LocalMetadataBankStatusResult> =>
    ipcRenderer.invoke(MVP_IPC.GET_LOCAL_METADATA_BANK),
  pickLocalMetadataBankFolder: (): Promise<PickLocalMetadataBankFolderResult> =>
    ipcRenderer.invoke(MVP_IPC.PICK_LOCAL_METADATA_BANK_FOLDER),
  refreshLocalMetadataBank: (): Promise<RefreshLocalMetadataBankResult> =>
    ipcRenderer.invoke(MVP_IPC.REFRESH_LOCAL_METADATA_BANK),
  listMusicLibrarySources: (): Promise<MusicLibrarySourcesResult> =>
    ipcRenderer.invoke(MVP_IPC.LIST_MUSIC_LIBRARY_SOURCES),
  addAdditionalMusicFolder: (): Promise<AddAdditionalMusicFolderResult> =>
    ipcRenderer.invoke(MVP_IPC.ADD_ADDITIONAL_MUSIC_FOLDER),
  removeAdditionalMusicFolder: (folderPath: string): Promise<RemoveAdditionalMusicFolderResult> =>
    ipcRenderer.invoke(MVP_IPC.REMOVE_ADDITIONAL_MUSIC_FOLDER, folderPath),
  scanMusicLibrary: (): Promise<ScanMusicLibraryResult> =>
    ipcRenderer.invoke(MVP_IPC.SCAN_MUSIC_LIBRARY),
  onStatus: (callback) => {
    const handler = (_: unknown, status: MvpStatusSnapshot) => {
      callback(status);
    };
    ipcRenderer.on(MVP_IPC.STATUS, handler);
    return () => {
      ipcRenderer.removeListener(MVP_IPC.STATUS, handler);
    };
  },
  // ── GUESTS × WhatsApp Web ──
  connectWhatsApp: (): Promise<WhatsAppStatus> => ipcRenderer.invoke(MVP_IPC.WHATSAPP_CONNECT),
  disconnectWhatsApp: (): Promise<WhatsAppStatus> => ipcRenderer.invoke(MVP_IPC.WHATSAPP_DISCONNECT),
  showWhatsAppWindow: (): Promise<void> => ipcRenderer.invoke(MVP_IPC.WHATSAPP_SHOW),
  hideWhatsAppWindow: (): Promise<void> => ipcRenderer.invoke(MVP_IPC.WHATSAPP_HIDE),
  setWhatsAppBounds: (bounds: WhatsAppBounds): Promise<void> =>
    ipcRenderer.invoke(MVP_IPC.WHATSAPP_SET_BOUNDS, bounds),
  setWhatsAppSolo: (on: boolean): Promise<void> =>
    ipcRenderer.invoke(MVP_IPC.WHATSAPP_SET_SOLO, on),
  onWhatsAppUrl: (cb) => {
    const handler = (_: unknown, url: string) => cb(url);
    ipcRenderer.on(MVP_IPC.WHATSAPP_URL, handler);
    return () => ipcRenderer.removeListener(MVP_IPC.WHATSAPP_URL, handler);
  },
  onWhatsAppStatus: (cb) => {
    const handler = (_: unknown, status: WhatsAppStatus) => cb(status);
    ipcRenderer.on(MVP_IPC.WHATSAPP_STATUS, handler);
    return () => ipcRenderer.removeListener(MVP_IPC.WHATSAPP_STATUS, handler);
  },
};

contextBridge.exposeInMainWorld("syncbizDesktop", api);

console.log("[SyncBiz desktop] preload: syncbizDesktop API exposed");
