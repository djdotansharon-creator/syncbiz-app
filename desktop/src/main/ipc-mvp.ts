import { BrowserWindow, ipcMain, app } from "electron";
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
import { DeviceWsManager } from "../device-websocket-client/device-ws-manager";
import { fetchBranchLibrarySummary } from "./branch-library-fetch";
import { loadRuntimeConfig, patchRuntimeConfig } from "./runtime-config-service";

let manager: DeviceWsManager | null = null;
let cachedConfig: DesktopRuntimeConfig | null = null;

function getUserData(): string {
  return app.getPath("userData");
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

export function registerMvpIpc(getWindow: () => BrowserWindow | null): void {
  cachedConfig = loadRuntimeConfig(getUserData());
  manager = new DeviceWsManager(cachedConfig);
  manager.onStatus((s) => {
    broadcast(getWindow(), s);
  });

  ipcMain.handle(MVP_IPC.GET_CONFIG, (): DesktopRuntimeConfig => {
    cachedConfig = loadRuntimeConfig(getUserData());
    if (manager) manager.setConfig(cachedConfig);
    return cachedConfig;
  });

  ipcMain.handle(MVP_IPC.GET_STATUS, (): MvpStatusSnapshot => {
    if (manager) return manager.snapshot();
    const c = loadRuntimeConfig(getUserData());
    return fallbackSnapshotFromConfig(c);
  });

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
      manager = new DeviceWsManager(cachedConfig);
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
      manager = new DeviceWsManager(c);
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
      manager = new DeviceWsManager(loadRuntimeConfig(getUserData()));
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
      manager = new DeviceWsManager(loadRuntimeConfig(getUserData()));
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
  };
}
