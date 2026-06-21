import { BrowserWindow, ipcMain, app, dialog } from "electron";
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
} from "../shared/mvp-types";
import { MVP_IPC } from "../shared/mvp-types";
import { applyAutoStart, readAutoStartState } from "./login-item-settings";
import {
  addAdditionalMusicFolder,
  listMusicLibrarySources,
  removeAdditionalMusicFolder,
  scanMusicLibrary,
} from "./additional-music-folders";
import { importLocalM3uPlaylist } from "./import-local-m3u-playlist";
import {
  defaultTagRenameXlsxPickerPath,
  importTagRenameXlsxFiles,
} from "./import-tag-rename-xlsx";
import {
  defaultLocalMetadataBankPickerPath,
  getLocalMetadataBankStatus,
  refreshLocalMetadataBank,
  setLocalMetadataBankFolder,
} from "./local-metadata-bank";
import { DeviceWsManager } from "../device-websocket-client/device-ws-manager";
import { fetchBranchLibrarySummary } from "./branch-library-fetch";
import { ensurePlaylistProRuntimeConfig } from "./playlistpro-config";
import { musicFolderDisplayLabel } from "../shared/playlistpro-paths";
import { loadRuntimeConfig, patchRuntimeConfig } from "./runtime-config-service";
import type { PlaybackOrchestrator } from "./playback-orchestrator";
import { scanLocalAudioFolder } from "./scan-local-audio-folder";
import { listMusicLibraryDir } from "./list-music-library-dir";
import { extractEmbeddedCoverDataUrlFromAudioFile } from "./extract-local-audio-cover";
import { extractLocalAudioTagFields, inspectLocalAudioTagsRaw } from "./extract-local-audio-tags";
import {
  enrichListMusicLibraryDirWithSnapshot,
  loadLocalCollectionSnapshot,
  loadLocalCollectionSnapshotCached,
  recordListDirAudioFilesInSnapshot,
  recordLocalAudioTagsInSnapshot,
  recordScanAudioFilesInSnapshot,
  searchLocalCollectionSnapshotInMemory,
  searchLocalForAiPlaylistInMemory,
} from "./local-collection-snapshot";

let manager: DeviceWsManager | null = null;
let cachedConfig: DesktopRuntimeConfig | null = null;
let orchestratorInstance: PlaybackOrchestrator | undefined;

function getUserData(): string {
  return app.getPath("userData");
}

function loadEffectiveRuntimeConfig(): DesktopRuntimeConfig {
  const raw = loadRuntimeConfig(getUserData());
  const next = ensurePlaylistProRuntimeConfig(getUserData(), raw);
  cachedConfig = next;
  return next;
}

function musicFolderSnapshotFromConfig(c: DesktopRuntimeConfig): MusicFolderSnapshot {
  const p = c.musicFolderPath?.trim() ? c.musicFolderPath.trim() : null;
  return {
    path: p,
    displayLabel: musicFolderDisplayLabel(p) ?? (p ? p.replace(/^.*[\\/]/, "") || null : null),
    isPlaylistProLibrary: Boolean(p && musicFolderDisplayLabel(p)),
  };
}

function normalizeApiBase(url: string): string {
  return url.replace(/\/+$/, "");
}

async function desktopSignInWithPassword(
  getWindow: () => BrowserWindow | null,
  email: string,
  password: string,
): Promise<DesktopSignInResult> {
  const cur = loadRuntimeConfig(getUserData());
  const base = normalizeApiBase(cur.apiBaseUrl ?? "");
  if (!base) {
    return { ok: false, error: "API base URL is not set." };
  }
  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/auth/desktop/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmedEmail, password }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Network error: ${msg}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Sign-in failed (HTTP ${res.status}).` };
  }

  const rec = body as { error?: string; token?: string; expiresAt?: string };
  if (!res.ok) {
    return { ok: false, error: rec.error ?? `Sign-in failed (HTTP ${res.status}).` };
  }
  if (typeof rec.token !== "string" || !rec.token.trim()) {
    return { ok: false, error: "Invalid response from server (no token)." };
  }

  const next = patchRuntimeConfig(getUserData(), cur, {
    wsToken: rec.token.trim(),
    lastAuthEmail: trimmedEmail,
    desktopTokenExpiresAtIso: typeof rec.expiresAt === "string" ? rec.expiresAt : undefined,
  });
  if (manager) manager.setConfig(next);
  broadcast(getWindow(), manager ? manager.snapshot() : fallbackSnapshotFromConfig(next));
  return { ok: true, config: next };
}

function broadcast(win: BrowserWindow | null, payload: MvpStatusSnapshot): void {
  const data = JSON.parse(JSON.stringify(payload)) as MvpStatusSnapshot;
  if (win && !win.isDestroyed()) {
    win.webContents.send(MVP_IPC.STATUS, data);
  }
}

export function registerMvpIpc(getWindow: () => BrowserWindow | null, orchestrator?: PlaybackOrchestrator): void {
  orchestratorInstance = orchestrator;
  cachedConfig = loadEffectiveRuntimeConfig();
  manager = new DeviceWsManager(cachedConfig, orchestratorInstance);
  manager.onStatus((s) => {
    broadcast(getWindow(), s);
  });

  ipcMain.handle(MVP_IPC.GET_CONFIG, (): DesktopRuntimeConfig => {
    cachedConfig = loadEffectiveRuntimeConfig();
    if (manager) manager.setConfig(cachedConfig);
    return cachedConfig;
  });

  ipcMain.handle(MVP_IPC.GET_STATUS, (): MvpStatusSnapshot => {
    if (manager) return manager.snapshot();
    const c = loadRuntimeConfig(getUserData());
    return fallbackSnapshotFromConfig(c);
  });

  ipcMain.handle(MVP_IPC.GET_APP_VERSION, (): string => app.getVersion());

  ipcMain.handle(MVP_IPC.SAVE_CONFIG, (_e, patch: MvpConfigPatch): DesktopRuntimeConfig => {
    const cur = loadRuntimeConfig(getUserData());
    const next = patchRuntimeConfig(getUserData(), cur, patch);
    cachedConfig = next;
    if (manager) manager.setConfig(next);
    broadcast(getWindow(), manager!.snapshot());
    return next;
  });

  ipcMain.handle(MVP_IPC.WS_CONNECT, (): MvpStatusSnapshot => {
    cachedConfig = loadRuntimeConfig(getUserData());
    if (!manager) {
      manager = new DeviceWsManager(cachedConfig, orchestratorInstance);
      manager.onStatus((s) => broadcast(getWindow(), s));
    } else {
      manager.setConfig(cachedConfig);
    }
    manager.connect();
    return manager.snapshot();
  });

  ipcMain.handle(MVP_IPC.WS_DISCONNECT, (): MvpStatusSnapshot => {
    if (manager) manager.disconnect();
    return manager ? manager.snapshot() : fallbackSnapshot();
  });

  ipcMain.handle(MVP_IPC.FETCH_BRANCH_LIBRARY, async (): Promise<BranchLibrarySummary> => {
    const c = loadRuntimeConfig(getUserData());
    const sum = await fetchBranchLibrarySummary(c);
    if (!manager) {
      manager = new DeviceWsManager(c, orchestratorInstance);
      manager.onStatus((s) => broadcast(getWindow(), s));
    } else {
      manager.setConfig(c);
    }
    if (sum.status === "ok" && Array.isArray(sum.items) && sum.items.length > 0) {
      manager.setBranchCatalog(sum.items);
    }
    return sum;
  });

  ipcMain.handle(MVP_IPC.SELECT_STATION_SOURCE, (_e, item: BranchLibraryItem): MvpStatusSnapshot => {
    if (!manager) {
      manager = new DeviceWsManager(loadRuntimeConfig(getUserData()), orchestratorInstance);
      manager.onStatus((s) => broadcast(getWindow(), s));
    }
    if (!item?.id?.trim() || !item.origin) {
      return manager.snapshot();
    }
    manager.selectStationSource(item);
    return manager.snapshot();
  });

  ipcMain.handle(MVP_IPC.LOCAL_MOCK_TRANSPORT, (_e, payload: LocalMockTransportPayload): MvpStatusSnapshot => {
    if (!manager) {
      manager = new DeviceWsManager(loadRuntimeConfig(getUserData()), orchestratorInstance);
      manager.onStatus((s) => broadcast(getWindow(), s));
    }
    manager.applyLocalMockTransport(payload);
    return manager.snapshot();
  });

  ipcMain.handle(
    MVP_IPC.DESKTOP_SIGN_IN,
    async (_e, creds: { email?: string; password?: string }): Promise<DesktopSignInResult> => {
      return desktopSignInWithPassword(getWindow, creds.email ?? "", creds.password ?? "");
    },
  );

  ipcMain.handle(MVP_IPC.MPV_PLAY_URL, (_e, url: string): void => {
    const u = typeof url === "string" ? url.trim() : "";
    if (!u) return;
    console.log("[SyncBiz:desktop-mpv:ipc] MPV_PLAY_URL (renderer test / dev) → playMusic", { preview: u.slice(0, 160) });
    orchestratorInstance?.playMusic(u);
  });

  ipcMain.handle(MVP_IPC.SET_MIX_DURATION, (_e, seconds: number): void => {
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      orchestratorInstance?.setCrossfadeSec(seconds);
    }
  });

  ipcMain.handle(
    MVP_IPC.MPV_PLAY_URL_CROSSFADE,
    (_e, payload: { url?: string; fadeSec?: number }): void => {
      const u = typeof payload?.url === "string" ? payload.url.trim() : "";
      if (!u) return;
      const fadeSec =
        typeof payload?.fadeSec === "number" && Number.isFinite(payload.fadeSec)
          ? Math.max(1, Math.min(30, payload.fadeSec))
          : (orchestratorInstance?.getCrossfadeSec() ?? 6);
      console.log("[SyncBiz:desktop-mpv:ipc] MPV_PLAY_URL_CROSSFADE", {
        preview: u.slice(0, 160),
        fadeSec,
      });
      orchestratorInstance?.playMusicCrossfade(u, fadeSec);
    },
  );

  ipcMain.handle(MVP_IPC.MPV_PLAY_INTERRUPT, (_e, url: string): void => {
    const u = typeof url === "string" ? url.trim() : "";
    if (!u) return;
    orchestratorInstance?.playInterrupt(u);
  });

  ipcMain.handle(MVP_IPC.SET_DUCK_PERCENT, (_e, n: number): void => {
    if (typeof n === "number" && Number.isFinite(n)) {
      orchestratorInstance?.setDuckPercent(n);
    }
  });

  ipcMain.handle(MVP_IPC.MPV_SEEK_TO, (_e, seconds: number): void => {
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      orchestratorInstance?.seekMusic(seconds);
    }
  });

  ipcMain.handle(MVP_IPC.SCAN_LOCAL_AUDIO_FOLDER, async (_e, dir: string): Promise<ScanLocalAudioFolderResult> => {
    if (typeof dir !== "string" || !dir.trim()) {
      return { status: "error", message: "Empty path" };
    }
    const result = await scanLocalAudioFolder(dir);
    if (result.status === "ok" && result.files.length > 0) {
      const cfg = loadRuntimeConfig(getUserData());
      void recordScanAudioFilesInSnapshot(getUserData(), cfg, result.files);
    }
    return result;
  });

  ipcMain.handle(MVP_IPC.GET_AUTOSTART, (): AutoStartState => readAutoStartState());

  ipcMain.handle(MVP_IPC.SET_AUTOSTART, (_e, enabled: unknown): AutoStartState => {
    const want = enabled === true;
    try {
      applyAutoStart(want);
    } catch (err) {
      console.error("[SyncBiz desktop] setLoginItemSettings failed:", err);
    }
    return readAutoStartState();
  });

  ipcMain.handle(MVP_IPC.GET_MUSIC_FOLDER, (): MusicFolderSnapshot => {
    const c = loadEffectiveRuntimeConfig();
    return musicFolderSnapshotFromConfig(c);
  });

  ipcMain.handle(MVP_IPC.PICK_MUSIC_FOLDER, async (): Promise<PickMusicFolderResult> => {
    const win = getWindow();
    let result: Electron.OpenDialogReturnValue;
    try {
      const opts: Electron.OpenDialogOptions = {
        title: "Choose music folder",
        properties: ["openDirectory"],
      };
      result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", message: msg };
    }
    if (result.canceled || result.filePaths.length === 0) {
      return { status: "canceled" };
    }
    const chosen = result.filePaths[0];
    const cur = loadRuntimeConfig(getUserData());
    const next = patchRuntimeConfig(getUserData(), cur, { musicFolderPath: chosen });
    cachedConfig = ensurePlaylistProRuntimeConfig(getUserData(), next);
    return { status: "ok", path: cachedConfig.musicFolderPath ?? chosen };
  });

  ipcMain.handle(MVP_IPC.CLEAR_MUSIC_FOLDER, (): MusicFolderSnapshot => {
    const cur = loadRuntimeConfig(getUserData());
    // Empty string clears in patchRuntimeConfig.
    const next = patchRuntimeConfig(getUserData(), cur, { musicFolderPath: "" });
    cachedConfig = ensurePlaylistProRuntimeConfig(getUserData(), next);
    return musicFolderSnapshotFromConfig(cachedConfig);
  });

  ipcMain.handle(MVP_IPC.PICK_TAG_RENAME_XLSX_FILES, async (): Promise<PickTagRenameXlsxFilesResult> => {
    const win = getWindow();
    const defaultPath = defaultTagRenameXlsxPickerPath();
    try {
      const opts: Electron.OpenDialogOptions = {
        title: "Import Tag&Rename metadata (XLSX)",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
        ...(defaultPath ? { defaultPath } : {}),
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) {
        return { status: "canceled" };
      }
      return { status: "ok", filePaths: result.filePaths };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", message: msg };
    }
  });

  ipcMain.handle(
    MVP_IPC.IMPORT_TAG_RENAME_XLSX_FILES,
    async (_e, filePathsRaw: unknown): Promise<ImportTagRenameXlsxFilesResult> => {
      const paths = Array.isArray(filePathsRaw)
        ? filePathsRaw.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        : typeof filePathsRaw === "string" && filePathsRaw.trim()
          ? [filePathsRaw.trim()]
          : [];
      if (paths.length === 0) {
        return { status: "error", message: "No XLSX file paths provided." };
      }
      try {
        const cfg = loadRuntimeConfig(getUserData());
        return await importTagRenameXlsxFiles(getUserData(), cfg, paths);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", message: msg };
      }
    },
  );

  ipcMain.handle(MVP_IPC.GET_LOCAL_METADATA_BANK, (): LocalMetadataBankStatusResult => {
    const cfg = loadEffectiveRuntimeConfig();
    return getLocalMetadataBankStatus(getUserData(), cfg);
  });

  ipcMain.handle(MVP_IPC.PICK_LOCAL_METADATA_BANK_FOLDER, async (): Promise<PickLocalMetadataBankFolderResult> => {
    const win = getWindow();
    const defaultPath = defaultLocalMetadataBankPickerPath();
    try {
      const opts: Electron.OpenDialogOptions = {
        title: "Choose Local Metadata Bank folder",
        properties: ["openDirectory"],
        ...(defaultPath ? { defaultPath } : {}),
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) {
        return { status: "canceled" };
      }
      const chosen = result.filePaths[0]!;
      const cur = loadRuntimeConfig(getUserData());
      setLocalMetadataBankFolder(getUserData(), cur, chosen);
      cachedConfig = loadRuntimeConfig(getUserData());
      return { status: "ok", path: chosen };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", message: msg };
    }
  });

  ipcMain.handle(
    MVP_IPC.REFRESH_LOCAL_METADATA_BANK,
    async (): Promise<RefreshLocalMetadataBankResult> => {
      try {
        const cfg = loadEffectiveRuntimeConfig();
        return await refreshLocalMetadataBank(getUserData(), cfg);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", message: msg };
      }
    },
  );

  // ----- Pilot: protected PlaylistPro + additional music folders -----

  ipcMain.handle(
    MVP_IPC.LIST_MUSIC_LIBRARY_SOURCES,
    (): MusicLibrarySourcesResult => {
      const cfg = loadEffectiveRuntimeConfig();
      return listMusicLibrarySources(getUserData(), cfg);
    },
  );

  ipcMain.handle(
    MVP_IPC.ADD_ADDITIONAL_MUSIC_FOLDER,
    async (): Promise<AddAdditionalMusicFolderResult> => {
      const win = getWindow();
      let result: Electron.OpenDialogReturnValue;
      try {
        const opts: Electron.OpenDialogOptions = {
          title: "Add music folder",
          properties: ["openDirectory"],
        };
        result = win
          ? await dialog.showOpenDialog(win, opts)
          : await dialog.showOpenDialog(opts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { status: "error", message: msg };
      }
      if (result.canceled || result.filePaths.length === 0) {
        return { status: "canceled" };
      }
      const chosen = result.filePaths[0]!;
      const cur = loadEffectiveRuntimeConfig();
      const { result: outcome, config: patched } = addAdditionalMusicFolder(
        getUserData(),
        cur,
        chosen,
      );
      cachedConfig = patched;
      if (manager) manager.setConfig(patched);
      return outcome;
    },
  );

  ipcMain.handle(
    MVP_IPC.REMOVE_ADDITIONAL_MUSIC_FOLDER,
    (_e, folderPath: unknown): RemoveAdditionalMusicFolderResult => {
      if (typeof folderPath !== "string" || !folderPath.trim()) {
        return { status: "error", message: "Empty path" };
      }
      const cur = loadEffectiveRuntimeConfig();
      const { result, config: patched } = removeAdditionalMusicFolder(
        getUserData(),
        cur,
        folderPath.trim(),
      );
      cachedConfig = patched;
      if (manager) manager.setConfig(patched);
      return result;
    },
  );

  ipcMain.handle(
    MVP_IPC.SCAN_MUSIC_LIBRARY,
    async (): Promise<ScanMusicLibraryResult> => {
      try {
        const cfg = loadEffectiveRuntimeConfig();
        return await scanMusicLibrary(getUserData(), cfg);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", message: msg };
      }
    },
  );

  ipcMain.handle(
    MVP_IPC.IMPORT_LOCAL_M3U_PLAYLIST,
    async (_e, filePath: unknown): Promise<ImportLocalM3uPlaylistResult> => {
      if (typeof filePath !== "string" || !filePath.trim()) {
        return { status: "error", message: "Empty playlist path." };
      }
      const cfg = loadRuntimeConfig(getUserData());
      return importLocalM3uPlaylist(getUserData(), cfg, filePath.trim());
    },
  );

  ipcMain.handle(
    MVP_IPC.SEARCH_LOCAL_COLLECTION_SNAPSHOT,
    (_e, query: unknown, limitRaw: unknown): SearchLocalCollectionSnapshotResult => {
      const q = typeof query === "string" ? query.trim() : "";
      let limit = 25;
      if (typeof limitRaw === "number" && Number.isFinite(limitRaw)) {
        limit = Math.min(100, Math.max(1, Math.trunc(limitRaw)));
      }
      if (q.length < 2) {
        return { status: "ok", hits: [] };
      }
      try {
        const cfg = loadRuntimeConfig(getUserData());
        const deviceId = (cfg.deviceId ?? "").trim() || "unknown";
        const snap = loadLocalCollectionSnapshotCached(getUserData(), deviceId);
        const hits = searchLocalCollectionSnapshotInMemory(snap, q, limit);
        return { status: "ok", hits };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", message: msg };
      }
    },
  );

  ipcMain.handle(
    MVP_IPC.SEARCH_LOCAL_FOR_AI_PLAYLIST,
    (_e, query: unknown, limitRaw: unknown): SearchLocalForAiPlaylistResult => {
      const q = typeof query === "string" ? query.trim() : "";
      let limit = 40;
      if (typeof limitRaw === "number" && Number.isFinite(limitRaw)) {
        limit = Math.min(80, Math.max(1, Math.trunc(limitRaw)));
      }
      if (q.length < 2) {
        return { status: "ok", candidates: [] };
      }
      try {
        const cfg = loadRuntimeConfig(getUserData());
        const deviceId = (cfg.deviceId ?? "").trim() || "unknown";
        const snap = loadLocalCollectionSnapshotCached(getUserData(), deviceId);
        const candidates = searchLocalForAiPlaylistInMemory(snap, q, limit);
        return { status: "ok", candidates };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", message: msg };
      }
    },
  );

  ipcMain.handle(
    MVP_IPC.LIST_MUSIC_LIBRARY_DIR,
    async (_e, subPath: string): Promise<ListMusicLibraryDirResult> => {
      const c = loadEffectiveRuntimeConfig();
      const root = c.musicFolderPath?.trim() ? c.musicFolderPath : null;
      const listed = await listMusicLibraryDir(root, typeof subPath === "string" ? subPath : "");
      const result =
        listed.status === "ok"
          ? await enrichListMusicLibraryDirWithSnapshot(getUserData(), c, listed)
          : listed;
      if (result.status === "ok" && result.files.length > 0) {
        void recordListDirAudioFilesInSnapshot(getUserData(), c, result.files);
      }
      return result;
    },
  );

  ipcMain.handle(
    MVP_IPC.GET_LOCAL_AUDIO_COVER,
    async (_e, filePath: unknown): Promise<GetLocalAudioCoverResult> => {
      if (typeof filePath !== "string" || !filePath.trim()) {
        return { status: "error", message: "Empty path" };
      }
      try {
        const dataUrl = await extractEmbeddedCoverDataUrlFromAudioFile(filePath.trim());
        return { status: "ok", dataUrl };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", message: msg };
      }
    },
  );

  ipcMain.handle(
    MVP_IPC.GET_LOCAL_AUDIO_TAGS,
    async (_e, filePath: unknown): Promise<GetLocalAudioTagsResult> => {
      if (typeof filePath !== "string" || !filePath.trim()) {
        return { status: "error", message: "Empty path" };
      }
      try {
        const trimmed = filePath.trim();
        const tags = await extractLocalAudioTagFields(trimmed);
        const cfg = loadRuntimeConfig(getUserData());
        void recordLocalAudioTagsInSnapshot(getUserData(), cfg, trimmed, tags);
        return { status: "ok", tags };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", message: msg };
      }
    },
  );

  ipcMain.handle(
    MVP_IPC.INSPECT_LOCAL_AUDIO_TAGS_RAW,
    async (_e, filePath: unknown): Promise<InspectLocalAudioTagsRawResult> => {
      if (typeof filePath !== "string" || !filePath.trim()) {
        return { status: "error", message: "Empty path" };
      }
      try {
        const payload = await inspectLocalAudioTagsRaw(filePath.trim());
        return { status: "ok", payload };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: "error", message: msg };
      }
    },
  );
}


function fallbackSnapshot(): MvpStatusSnapshot {
  const c = cachedConfig ?? loadRuntimeConfig(getUserData());
  return fallbackSnapshotFromConfig(c);
}

function fallbackSnapshotFromConfig(c: DesktopRuntimeConfig): MvpStatusSnapshot {
  return {
    appReady: true,
    deviceId: c.deviceId,
    branchId: c.branchId,
    workspaceLabel: c.workspaceLabel,
    wsUrl: c.wsUrl,
    hasToken: c.wsToken.trim().length > 0,
    wsState: "disconnected",
    registered: false,
    deviceRole: "unknown",
    commandReady: false,
    mockPlaybackStatus: "idle",
    mockVolume: 80,
    mockCurrentSourceLabel: "—",
    mockSelectedLibraryId: null,
    mockSelectedLibraryKind: null,
    mockSelectedSourceType: null,
    mockCurrentSourceCoverUrl: null,
    branchCatalogCount: 0,
    branchCatalogIndex: null,
    lastServerMessageType: null,
    lastCommandSummary: null,
    lastError: null,
    isDucked: false,
    duckTargetVolume: 0,
    duckPercent: 40,
    mpvPosition: 0,
    mpvDuration: 0,
    mpvEngineReady: false,
    mpvLastError: null,
  };
}
