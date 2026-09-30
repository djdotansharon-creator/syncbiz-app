import { BrowserWindow, ipcMain, app, dialog } from "electron";
import { existsSync, readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import type {
  AddAdditionalMusicFolderResult,
  AutoStartState,
  ProtectionState,
  ExitVonoResult,
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
import { redactMediaToken } from "../shared/redact-media-token";
import { WhatsAppWindow } from "./whatsapp-view";
import { updateFromMpv } from "./heartbeat-writer";
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
import { reconcileDeviceIdentity, stripDeviceIdFromPatch } from "./device-identity-reconcile";
import { fileLog } from "./file-logger";
import {
  StationDeviceRegistrar,
  pickRegistrationRelevant,
  registrationRelevantChanged,
  type RegistrationRelevant,
} from "./station-device-registration";
import { vonoProtectionStatePath, vonoControlPath } from "./vono-paths";
import {
  createProtectionService,
  VONO_PROTECTION_TASK_NAME,
  type ProtectionService,
} from "./protection-service";
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

/**
 * Phase 0.1 — DURABLE MACHINE (STATION) IDENTITY. The authoritative MAIN deviceId is
 * C:\ProgramData\VONO\state\device-id.json (survives userData loss / reinstall). ProgramData is the IMMUTABLE
 * runtime authority: reconcileDeviceIdentity() forces config.deviceId back to the durable id whenever they
 * differ, so the MAIN WS registration (DeviceWsManager uses config.deviceId) and the heartbeat can never drift
 * from ProgramData — including after a manual/runtime config edit. NOTE: the renderer keeps its OWN localStorage
 * id — unifying the two planes on one deviceId would collide in the server `devices` Map (see lib/device-id.ts).
 */
function loadEffectiveRuntimeConfig(): DesktopRuntimeConfig {
  const raw = loadRuntimeConfig(getUserData());
  const withPro = ensurePlaylistProRuntimeConfig(getUserData(), raw);
  const next = reconcileDeviceIdentity(getUserData(), withPro);
  cachedConfig = next;
  return next;
}

/**
 * The reconciled effective runtime config (durable MAIN deviceId re-asserted from ProgramData). ALWAYS runs the
 * full pipeline (raw → PlaylistPro normalize → reconcileDeviceIdentity → cachedConfig) — it must never return a
 * possibly-poisoned cachedConfig without reconciliation, or a handler that poisoned cachedConfig could leak a
 * drifted deviceId to a later consumer. ProgramData is re-asserted every time effective MAIN config is requested.
 */
export function getEffectiveRuntimeConfig(): DesktopRuntimeConfig {
  return loadEffectiveRuntimeConfig();
}

// Phase 0.2A — MAIN-only cloud station registration (HTTP; never touches WS/MASTER/Protection/config).
let stationRegistrar: StationDeviceRegistrar | null = null;
function getStationRegistrar(): StationDeviceRegistrar {
  if (!stationRegistrar) {
    stationRegistrar = new StationDeviceRegistrar({
      getConfig: () => {
        const c = getEffectiveRuntimeConfig(); // reconciled durable id; READ-ONLY (no mutation on responses)
        return {
          deviceId: c.deviceId,
          branchId: c.branchId,
          wsToken: c.wsToken,
          apiBaseUrl: c.apiBaseUrl,
          desktopTokenExpiresAtIso: c.desktopTokenExpiresAtIso,
        };
      },
      appVersion: app.getVersion(),
      platform: process.platform,
      fetchImpl: fetch,
      now: () => Date.now(),
      setTimer: (fn, ms) => {
        const t = setTimeout(() => void fn(), ms);
        if (typeof t.unref === "function") t.unref(); // never keep the app alive / interfere with shutdown
      },
      log: (event, fields) =>
        fileLog(/error|conflict|forbidden|unauthorized|exhausted/.test(event) ? "WARN" : "INFO", event, fields),
    });
  }
  return stationRegistrar;
}

// Phase B1 — VONO Protection (Scheduled Task + intentional-stop). NEVER touches identity/branch/MASTER/playback.
let protectionService: ProtectionService | null = null;
export function getProtectionService(): ProtectionService {
  if (!protectionService) {
    const installDir = dirname(process.execPath); // packaged: the INSTDIR holding the .exe + vono-watchdog\
    const watchdogDir = join(installDir, "vono-watchdog");
    const provisionScript = join(watchdogDir, "provision-vono-protection.ps1");
    const psExe = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    // ASYNC PowerShell — NEVER spawnSync. A synchronous PowerShell call blocked Electron MAIN for tens of seconds
    // on the pilot Lenovo (heartbeat stopped, renderer saw a playback freeze and restarted the track). This runs
    // the child off-thread with a hard timeout that KILLS the child; a timeout/spawn error resolves to a distinct
    // signal the callers map to UNKNOWN / fail-closed. shell:false + arg array (no shell interpolation).
    const runPs = (args: string[], timeoutMs = 60_000): Promise<{ status: number | null; stderr: string; timedOut: boolean }> =>
      new Promise((resolve) => {
        let child: import("node:child_process").ChildProcess;
        try {
          child = spawn(psExe, args, { windowsHide: true, shell: false });
        } catch (e) {
          resolve({ status: null, stderr: (e as Error)?.message ?? String(e), timedOut: false });
          return;
        }
        let stderr = "";
        let settled = false;
        const finish = (r: { status: number | null; stderr: string; timedOut: boolean }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(r);
        };
        const timer = setTimeout(() => {
          try { child.kill(); } catch { /* ignore */ }
          finish({ status: null, stderr: `timed out after ${timeoutMs}ms`, timedOut: true });
        }, timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
        child.stderr?.on("data", (d) => { stderr += d.toString(); });
        child.on("error", (e) => finish({ status: null, stderr: e.message, timedOut: false }));
        child.on("close", (code) => finish({ status: code, stderr: stderr.trim(), timedOut: false }));
      });
    protectionService = createProtectionService({
      now: () => Date.now(),
      platform: process.platform,
      readFile: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
      writeFile: (p, data) => writeFileSync(p, data, "utf-8"),
      removeFile: (p) => { try { rmSync(p, { force: true }); } catch { /* ignore */ } },
      renameFile: (from, to) => renameSync(from, to), // same-dir atomic replace (mirrors watchdog saveCacheAtomic)
      protectionStatePath: vonoProtectionStatePath,
      controlPath: vonoControlPath,
      taskStatus: async () => {
        // Tri-state, fail-CLOSED. Absence is POSITIVELY observed: only the "task not found" error
        // (CategoryInfo.Category === ObjectNotFound) counts as absent (exit 3). Any OTHER failure — a broken
        // Task Scheduler / CIM subsystem, access error, PS crash, non-interactive block, OR a TIMEOUT — is
        // UNKNOWN, never silently read as "absent". Present = exit 0.
        const { status, stderr, timedOut } = await runPs([
          "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
          `try { if (Get-ScheduledTask -TaskName '${VONO_PROTECTION_TASK_NAME}' -ErrorAction Stop) { exit 0 } else { exit 3 } } ` +
            `catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { exit 3 } else { exit 1 } }`,
        ]);
        if (timedOut) return { ok: false, error: "task query timed out" };
        if (status === 0) return { ok: true, present: true };
        if (status === 3) return { ok: true, present: false };
        return { ok: false, error: stderr || `task query exited ${status}` };
      },
      requiredWatchdogFilesPresent: () =>
        ["node.exe", "watchdog.cjs", "launch-watchdog.ps1", "provision-vono-protection.ps1"].every((f) =>
          existsSync(join(watchdogDir, f)),
        ),
      provision: async (action) => {
        const { status, stderr, timedOut } = await runPs([
          "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
          "-File", provisionScript, "-Action", action, "-InstallDir", installDir,
        ]);
        if (timedOut) return { ok: false, error: `provision ${action} timed out` };
        return status === 0 ? { ok: true } : { ok: false, error: stderr || `provision ${action} exited ${status}` };
      },
      disableElectronAutostart: () => {
        // Fail-CLOSED: the Scheduled Task must be the ONE start mechanism, so this ONLY reports ok when a
        // successful read PROVES openAtLogin is false. A set failure, a verify-read failure, or a still-on
        // read all return ok:false (never assume success).
        try {
          app.setLoginItemSettings({ openAtLogin: false });
        } catch (e) {
          return { ok: false, error: (e as Error)?.message || "setLoginItemSettings failed." };
        }
        let openAtLogin: boolean;
        try {
          openAtLogin = app.getLoginItemSettings().openAtLogin === true;
        } catch (e) {
          return { ok: false, error: (e as Error)?.message || "Could not verify the OS login-item state." };
        }
        return openAtLogin ? { ok: false, error: "OS login-item auto-start is still enabled." } : { ok: true };
      },
      log: (event, fields) =>
        fileLog(/fail|missing|still_present/.test(event) ? "WARN" : "INFO", event, fields ?? {}),
    });
  }
  return protectionService;
}

/** Snapshot the registration-relevant config for change detection (SAVE_CONFIG trigger). */
function registrationRelevantOf(c: DesktopRuntimeConfig | null): RegistrationRelevant | null {
  if (!c) return null;
  return pickRegistrationRelevant({
    deviceId: c.deviceId,
    branchId: c.branchId,
    wsToken: c.wsToken,
    apiBaseUrl: c.apiBaseUrl,
  });
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

  const next = reconcileDeviceIdentity(getUserData(), patchRuntimeConfig(getUserData(), cur, {
    wsToken: rec.token.trim(),
    lastAuthEmail: trimmedEmail,
    desktopTokenExpiresAtIso: typeof rec.expiresAt === "string" ? rec.expiresAt : undefined,
  }));
  if (manager) manager.setConfig(next);
  // Phase 0.2A trigger (B) — SIGN-IN: register under the freshly persisted+reconciled token scope. Fire-and-forget.
  getStationRegistrar().trigger("signin");
  broadcast(getWindow(), manager ? manager.snapshot() : fallbackSnapshotFromConfig(next));
  return { ok: true, config: next };
}

function broadcast(win: BrowserWindow | null, payload: MvpStatusSnapshot): void {
  const data = JSON.parse(JSON.stringify(payload)) as MvpStatusSnapshot;
  if (win && !win.isDestroyed()) {
    win.webContents.send(MVP_IPC.STATUS, data);
  }
  // VONO heartbeat — single chokepoint. EVERY status path funnels through broadcast(), so the
  // heartbeat is fed regardless of which manager.onStatus registration produced the snapshot
  // (avoids going stale after a config-patch manager re-creation). Main-process only; no-op until
  // startHeartbeat() runs. No renderer/IPC/playback change.
  updateFromMpv(data);
}

export function registerMvpIpc(getWindow: () => BrowserWindow | null, orchestrator?: PlaybackOrchestrator): void {
  orchestratorInstance = orchestrator;
  cachedConfig = loadEffectiveRuntimeConfig();
  manager = new DeviceWsManager(cachedConfig, orchestratorInstance);
  manager.onStatus((s) => {
    broadcast(getWindow(), s);
  });

  // Phase 0.2A trigger (A) — STARTUP: fire-and-forget cloud registration if a token is present. Never awaited,
  // so it can never delay playback / window / WS startup. Skips silently when no token (returning-user path).
  getStationRegistrar().trigger("startup");

  ipcMain.handle(MVP_IPC.GET_CONFIG, (): DesktopRuntimeConfig => {
    cachedConfig = loadEffectiveRuntimeConfig();
    if (manager) manager.setConfig(cachedConfig);
    return cachedConfig;
  });

  ipcMain.handle(MVP_IPC.GET_STATUS, (): MvpStatusSnapshot => {
    if (manager) return manager.snapshot();
    return fallbackSnapshot(); // reconciled durable deviceId, never raw config
  });

  ipcMain.handle(MVP_IPC.GET_APP_VERSION, (): string => app.getVersion());

  // ── GUESTS × WhatsApp Web (desktop-only) ──
  const whatsapp = new WhatsAppWindow(
    {
      onUrl: (url) => {
        const w = getWindow();
        if (w && !w.isDestroyed()) w.webContents.send(MVP_IPC.WHATSAPP_URL, url);
      },
      onStatus: (status) => {
        const w = getWindow();
        if (w && !w.isDestroyed()) w.webContents.send(MVP_IPC.WHATSAPP_STATUS, status);
      },
    },
    getWindow,
  );
  ipcMain.handle(MVP_IPC.WHATSAPP_CONNECT, (): WhatsAppStatus => whatsapp.connect());
  ipcMain.handle(MVP_IPC.WHATSAPP_DISCONNECT, (): Promise<WhatsAppStatus> => whatsapp.disconnect());
  ipcMain.handle(MVP_IPC.WHATSAPP_SHOW, (): void => whatsapp.show());
  ipcMain.handle(MVP_IPC.WHATSAPP_HIDE, (): void => whatsapp.hide());
  ipcMain.handle(MVP_IPC.WHATSAPP_SET_BOUNDS, (_e, bounds: WhatsAppBounds): void => {
    if (
      bounds &&
      typeof bounds.x === "number" &&
      typeof bounds.y === "number" &&
      typeof bounds.width === "number" &&
      typeof bounds.height === "number"
    ) {
      whatsapp.setBounds(bounds);
    }
  });
  ipcMain.handle(MVP_IPC.WHATSAPP_SET_SOLO, (_e, on: unknown): void => {
    whatsapp.setSoloMode(on !== false);
  });

  ipcMain.handle(MVP_IPC.SAVE_CONFIG, (_e, patch: MvpConfigPatch): DesktopRuntimeConfig => {
    // Phase 0.1: deviceId is NOT settable at runtime — ProgramData is the immutable authority. Drop any
    // patch.deviceId, apply the rest, then reconcile back to the durable MAIN id so a manual/renderer patch
    // can never drift config.deviceId (and thus DeviceWsManager REGISTER / heartbeat) away from ProgramData.
    const beforeRelevant = registrationRelevantOf(cachedConfig); // effective config prior to this save
    const safePatch = stripDeviceIdFromPatch(patch);
    const cur = loadRuntimeConfig(getUserData());
    const patched = patchRuntimeConfig(getUserData(), cur, safePatch);
    const next = reconcileDeviceIdentity(getUserData(), patched);
    cachedConfig = next;
    if (manager) manager.setConfig(next);
    // Phase 0.2A trigger (C) — CONFIG CHANGE: only when a registration-relevant value (branchId / apiBaseUrl /
    // wsToken) actually changed, never for unrelated settings. A branch change may 409 server-side; the registrar
    // logs the conflict and NEVER auto-rebinds or rewrites branchId. Fire-and-forget.
    if (registrationRelevantChanged(beforeRelevant, registrationRelevantOf(next)!)) {
      getStationRegistrar().trigger("config-change");
    }
    broadcast(getWindow(), manager!.snapshot());
    return next;
  });

  ipcMain.handle(MVP_IPC.WS_CONNECT, (): MvpStatusSnapshot => {
    // Use the RECONCILED effective config (durable ProgramData id applied) — never raw loadRuntimeConfig() —
    // so REGISTER always uses the durable MAIN deviceId even if the raw config was manually changed.
    cachedConfig = loadEffectiveRuntimeConfig();
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
    const c = reconcileDeviceIdentity(getUserData(), loadRuntimeConfig(getUserData())); // durable id before feeding the manager
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
      manager = new DeviceWsManager(reconcileDeviceIdentity(getUserData(), loadRuntimeConfig(getUserData())), orchestratorInstance);
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
      manager = new DeviceWsManager(reconcileDeviceIdentity(getUserData(), loadRuntimeConfig(getUserData())), orchestratorInstance);
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

  ipcMain.handle(MVP_IPC.MPV_PLAY_URL, (_e, url: string, attemptId?: number): void => {
    const u = typeof url === "string" ? url.trim() : "";
    if (!u) return;
    const aid = typeof attemptId === "number" && Number.isFinite(attemptId) ? attemptId : 0;
    console.log("[SyncBiz:desktop-mpv:ipc] MPV_PLAY_URL → playMusic", { preview: redactMediaToken(u).slice(0, 160), attemptId: aid });
    orchestratorInstance?.playMusic(u, aid);
    // Immediately push state snapshot so the renderer's desktopMpvSnap reflects any
    // synchronous failures (binary missing, null child) as well as engine-ready status.
    // play() calls push() synchronously on failure, so manager.snapshot() already
    // has the updated mpvEngineReady / mpvLastError by the time we reach this line.
    broadcast(getWindow(), manager ? manager.snapshot() : fallbackSnapshot());
  });

  ipcMain.handle(MVP_IPC.SET_MIX_DURATION, (_e, seconds: number): void => {
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      orchestratorInstance?.setCrossfadeSec(seconds);
    }
  });

  ipcMain.handle(
    MVP_IPC.MPV_PLAY_URL_CROSSFADE,
    (_e, payload: { url?: string; fadeSec?: number; attemptId?: number }): void => {
      const u = typeof payload?.url === "string" ? payload.url.trim() : "";
      if (!u) return;
      const fadeSec =
        typeof payload?.fadeSec === "number" && Number.isFinite(payload.fadeSec)
          ? Math.max(1, Math.min(30, payload.fadeSec))
          : (orchestratorInstance?.getCrossfadeSec() ?? 6);
      const aid = typeof payload?.attemptId === "number" && Number.isFinite(payload.attemptId) ? payload.attemptId : 0;
      console.log("[SyncBiz:desktop-mpv:ipc] MPV_PLAY_URL_CROSSFADE", {
        preview: redactMediaToken(u).slice(0, 160),
        fadeSec,
        attemptId: aid,
      });
      orchestratorInstance?.playMusicCrossfade(u, fadeSec, aid);
      broadcast(getWindow(), manager ? manager.snapshot() : fallbackSnapshot());
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
      const cfg = loadEffectiveRuntimeConfig(); // device-scoped snapshot is keyed by cfg.deviceId → durable id
      void recordScanAudioFilesInSnapshot(getUserData(), cfg, result.files);
    }
    return result;
  });

  ipcMain.handle(MVP_IPC.GET_AUTOSTART, (): AutoStartState => readAutoStartState());

  ipcMain.handle(MVP_IPC.SET_AUTOSTART, (_e, enabled: unknown): AutoStartState => {
    const want = enabled === true;
    try {
      app.setLoginItemSettings({ openAtLogin: want });
    } catch (err) {
      console.error("[SyncBiz desktop] setLoginItemSettings failed:", err);
    }
    return readAutoStartState();
  });

  // ── Phase B1 — VONO Protection (the real unattended-player control; NOT openAtLogin) ──
  // ASYNC handlers: the service runs PowerShell off-thread, so these never block MAIN / the heartbeat / playback,
  // and the service's single-flight lock serializes overlapping GET/SET/EXIT.
  ipcMain.handle(MVP_IPC.GET_PROTECTION_STATE, async (): Promise<ProtectionState> => getProtectionService().getEffective());
  ipcMain.handle(MVP_IPC.SET_PROTECTION_STATE, async (_e, enabled: unknown): Promise<ProtectionState> => {
    const res = await getProtectionService().setEnabled(enabled === true, "app");
    return res.state;
  });
  ipcMain.handle(MVP_IPC.EXIT_VONO, async (): Promise<ExitVonoResult> => {
    // Explicit user exit, decided on LIVE recovery risk (desired-ON OR a live task present) — not just the
    // persisted flag. requestExit() writes+verifies the intentional-stop marker when required and returns
    // ok:false (with no quit) when the marker can't be written OR the task status is unknown. Only quit on ok.
    const svc = getProtectionService();
    let decision: ExitVonoResult;
    try {
      decision = await svc.requestExit();
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      fileLog("WARN", "EXIT_VONO: requestExit threw — NOT quitting", { err });
      return { ok: false, error: "Could not determine a safe exit; VONO was not stopped." };
    }
    if (!decision.ok) {
      fileLog("WARN", "EXIT_VONO: unsafe to quit — NOT quitting", { err: decision.error });
      return { ok: false, error: decision.error };
    }
    // Defer the quit so this IPC reply flushes to the renderer first.
    setImmediate(() => app.quit());
    return { ok: true };
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
    cachedConfig = reconcileDeviceIdentity(getUserData(), ensurePlaylistProRuntimeConfig(getUserData(), next));
    return { status: "ok", path: cachedConfig.musicFolderPath ?? chosen };
  });

  ipcMain.handle(MVP_IPC.CLEAR_MUSIC_FOLDER, (): MusicFolderSnapshot => {
    const cur = loadRuntimeConfig(getUserData());
    // Empty string clears in patchRuntimeConfig.
    const next = patchRuntimeConfig(getUserData(), cur, { musicFolderPath: "" });
    cachedConfig = reconcileDeviceIdentity(getUserData(), ensurePlaylistProRuntimeConfig(getUserData(), next));
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
      cachedConfig = reconcileDeviceIdentity(getUserData(), loadRuntimeConfig(getUserData())); // keep cachedConfig on the durable id
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
      const cfg = loadEffectiveRuntimeConfig(); // import keys the device snapshot by cfg.deviceId → durable id
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
        const cfg = loadEffectiveRuntimeConfig(); // snapshot lookup keyed by cfg.deviceId → durable id
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
        const cfg = loadEffectiveRuntimeConfig(); // snapshot lookup keyed by cfg.deviceId → durable id
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

  // POC-ONLY, read-only: return the OFFLINE-READY POC playlist from the local manifest as ABSOLUTE
  // local paths. Never writes. Returns { available:false, reason } if missing or not fully ready.
  ipcMain.handle(MVP_IPC.GET_OFFLINE_POC_PLAYLIST, async () => {
    try {
      const candidates = [
        join(app.getAppPath(), ".poc-cache"),
        join(process.cwd(), ".poc-cache"),
        join(process.cwd(), "desktop", ".poc-cache"),
      ];
      const base = candidates.find((c) => existsSync(join(c, "manifest.json")));
      if (!base) return { available: false, reason: "no-manifest" };
      const m = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
      const pl = m?.playlists?.["poc-samples"];
      if (!pl || !Array.isArray(pl.assetIds) || pl.assetIds.length === 0) {
        return { available: false, reason: "no-playlist" };
      }
      const tracks: { id: string; name: string; url: string }[] = [];
      for (const assetId of pl.assetIds) {
        const a = m.assets?.[assetId];
        if (!a || a.status !== "ready" || !a.localPath) return { available: false, reason: "not-ready" };
        const abs = join(base, a.localPath);
        if (!existsSync(abs)) return { available: false, reason: "missing-file" };
        tracks.push({ id: assetId, name: a.name || assetId, url: abs });
      }
      return { available: true, title: pl.title || "Offline POC", tracks };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : String(e) };
    }
  });

  // POC-ONLY, read-only: resolve Royalty-Free Music sample assets from the SEPARATE preview cache
  // (.poc-preview-cache, distinct from the offline .poc-cache). Returns absolute local paths keyed by
  // stable asset id so the catalog can play samples through the real chain. Never writes. This is a
  // PREVIEW cache (lets samples be heard in the POC); it is NOT an offline playlist and must never be
  // presented as OFFLINE READY.
  ipcMain.handle(MVP_IPC.GET_MUSIC_BANK_PREVIEW_PATHS, async () => {
    try {
      const candidates = [
        join(app.getAppPath(), ".poc-preview-cache"),
        join(process.cwd(), ".poc-preview-cache"),
        join(process.cwd(), "desktop", ".poc-preview-cache"),
      ];
      const base = candidates.find((c) => existsSync(join(c, "manifest.json")));
      if (!base) return { available: false, reason: "no-manifest" };
      const m = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
      const assets = (m && typeof m === "object" ? m.assets : null) || {};
      const tracks: { id: string; url: string }[] = [];
      for (const [id, aRaw] of Object.entries(assets)) {
        const a = aRaw as { status?: string; localPath?: string } | null;
        if (!a || a.status !== "ready" || !a.localPath) continue;
        const abs = join(base, a.localPath);
        if (!existsSync(abs)) continue;
        tracks.push({ id, url: abs });
      }
      return { available: tracks.length > 0, tracks };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(
    MVP_IPC.GET_LOCAL_AUDIO_TAGS,
    async (_e, filePath: unknown): Promise<GetLocalAudioTagsResult> => {
      if (typeof filePath !== "string" || !filePath.trim()) {
        return { status: "error", message: "Empty path" };
      }
      try {
        const trimmed = filePath.trim();
        const tags = await extractLocalAudioTagFields(trimmed);
        const cfg = loadEffectiveRuntimeConfig(); // device-scoped snapshot keyed by cfg.deviceId → durable id
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

function readAutoStartState(): AutoStartState {
  // Linux: openAtLogin is supported on AppImage and a few configurations, but not
  // universally. Electron returns `false` for `executableWillLaunchAtLogin` on
  // unsupported setups; we surface a `supported` flag so the UI can disable the
  // toggle rather than silently no-op.
  const supported = process.platform === "win32" || process.platform === "darwin";
  try {
    const settings = app.getLoginItemSettings();
    return {
      enabled: Boolean(settings.openAtLogin),
      supported,
    };
  } catch (err) {
    console.error("[SyncBiz desktop] getLoginItemSettings failed:", err);
    return { enabled: false, supported };
  }
}

function fallbackSnapshot(): MvpStatusSnapshot {
  // Emits deviceId → must be the reconciled durable id, never a possibly-poisoned cachedConfig / raw config.
  return fallbackSnapshotFromConfig(getEffectiveRuntimeConfig());
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
    mpvAttemptId: 0,
    mpvAttemptMode: "cold",
  };
}
