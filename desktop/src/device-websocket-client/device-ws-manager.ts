/**
 * Device WebSocket client — runs in the Electron main process (Node).
 * Protocol aligned with server/index.ts + lib/remote-control/types (REGISTER as device).
 */

import WebSocket from "ws";
import { MockPlaybackSession } from "../playback-agent";
import type { PlaybackOrchestrator } from "../main/playback-orchestrator";
import type {
  BranchLibraryItem,
  DesktopRuntimeConfig,
  LocalMockTransportPayload,
  MvpConnectionState,
  MvpDeviceRole,
  MvpStatusSnapshot,
} from "../shared/mvp-types";
import type { StationPlaybackState } from "../shared/station-state";
import { registrationIntentBranchDesktopApp } from "../shared/syncbiz-registration-intent";

type StatusListener = (s: MvpStatusSnapshot) => void;

type ParsedIncoming = {
  type: string;
  mode?: MvpDeviceRole;
  command?: string;
  payload?: unknown;
  message?: string;
};

function parseIncoming(raw: string): ParsedIncoming {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const t = typeof o.type === "string" ? o.type : "?";
    const out: ParsedIncoming = { type: t };
    if (t === "SET_DEVICE_MODE" && (o.mode === "MASTER" || o.mode === "CONTROL")) {
      out.mode = o.mode;
    }
    if (t === "COMMAND" && typeof o.command === "string") {
      out.command = o.command;
      out.payload = o.payload;
    }
    if (t === "ERROR" && typeof o.message === "string") {
      out.message = o.message;
    }
    return out;
  } catch {
    return { type: "parse_error" };
  }
}

export class DeviceWsManager {
  private ws: WebSocket | null = null;
  private config: DesktopRuntimeConfig;
  private wsState: MvpConnectionState = "disconnected";
  private registered = false;
  private deviceRole: MvpDeviceRole = "unknown";
  private readonly mock = new MockPlaybackSession();
  private readonly orchestrator: PlaybackOrchestrator | null;
  /** Order matches branch library fetch; used for PREV/NEXT station selection (mock only). */
  private branchCatalog: BranchLibraryItem[] = [];
  private lastServerMessageType: string | null = null;
  private lastCommandSummary: string | null = null;
  private lastError: string | null = null;
  private listener: StatusListener | null = null;

  constructor(initialConfig: DesktopRuntimeConfig, orchestrator?: PlaybackOrchestrator) {
    this.config = initialConfig;
    this.orchestrator = orchestrator ?? null;
    if (this.orchestrator) {
      // Sync real playback events (music channel) into tracked state and re-broadcast.
      this.orchestrator.onStatus((s) => {
        this.mock.syncMpvStatus(s.music);
        this.push();
        this.sendStateUpdateIfMaster();
      });
    }
  }

  setConfig(c: DesktopRuntimeConfig): void {
    this.config = c;
  }

  onStatus(fn: StatusListener): void {
    this.listener = fn;
  }

  private push(): void {
    if (this.listener) {
      this.listener(this.snapshot());
    }
  }

  private sendStateUpdateIfMaster(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.registered || this.deviceRole !== "MASTER") return;
    const state: StationPlaybackState = this.mock.getState();
    this.ws.send(JSON.stringify({ type: "STATE_UPDATE", state }));
  }

  snapshot(): MvpStatusSnapshot {
    const c = this.config;
    const st = this.mock.getState();
    const commandReady = this.registered && this.wsState === "connected" && this.deviceRole === "MASTER";
    const src = st.currentSource;
    let branchCatalogIndex: number | null = null;
    if (this.branchCatalog.length > 0 && src?.id) {
      const bi = this.branchCatalog.findIndex((i) => i.id === src.id);
      branchCatalogIndex = bi >= 0 ? bi : null;
    }
    const orchState = this.orchestrator?.getState();
    return {
      appReady: true,
      deviceId: c.deviceId,
      branchId: c.branchId,
      workspaceLabel: c.workspaceLabel,
      wsUrl: c.wsUrl,
      hasToken: c.wsToken.trim().length > 0,
      wsState: this.wsState,
      registered: this.registered,
      deviceRole: this.deviceRole,
      commandReady,
      mockPlaybackStatus: st.status,
      mockVolume: st.volume ?? 0,
      mockCurrentSourceLabel: this.mock.sourceLabel,
      mockSelectedLibraryId: src?.id ?? null,
      mockSelectedLibraryKind: src?.origin ?? null,
      mockSelectedSourceType: src?.sourceType ?? null,
      mockCurrentSourceCoverUrl: src?.cover ?? null,
      branchCatalogCount: this.branchCatalog.length,
      branchCatalogIndex,
      lastServerMessageType: this.lastServerMessageType,
      lastCommandSummary: this.lastCommandSummary,
      lastError: this.lastError,
      isDucked: orchState?.isDucked ?? false,
      duckTargetVolume: orchState?.duckTargetVolume ?? 0,
      duckPercent: orchState?.duckPercent ?? 40,
      mpvPosition: st.position ?? 0,
      mpvDuration: st.duration ?? 0,
    };
  }

  /**
   * Local-only: set branch library row as mock station context (no server write, no MPV).
   */
  /** Replace catalog with API list (after branch library fetch). */
  setBranchCatalog(items: BranchLibraryItem[]): void {
    this.branchCatalog = items.slice();
    this.push();
  }

  selectStationSource(item: BranchLibraryItem): void {
    if (this.branchCatalog.length === 0) {
      this.branchCatalog = [item];
    }
    this.mock.setStationSelection({
      id: item.id,
      title: item.title,
      cover: item.cover,
      origin: item.origin,
      sourceType: item.type,
      url: item.url,
    });
    this.push();
    this.sendStateUpdateIfMaster();
  }

  /** Move mock station selection along `branchCatalog` (wraps). */
  private navigateCatalogStep(direction: "PREV" | "NEXT"): boolean {
    if (this.branchCatalog.length === 0) {
      this.lastCommandSummary = `${direction} (no catalog — refresh library or pick a row)`;
      return false;
    }
    const curId = this.mock.getState().currentSource?.id ?? null;
    let idx = curId ? this.branchCatalog.findIndex((i) => i.id === curId) : -1;
    if (idx < 0) idx = 0;
    else if (direction === "NEXT") idx = (idx + 1) % this.branchCatalog.length;
    else idx = (idx - 1 + this.branchCatalog.length) % this.branchCatalog.length;
    const next = this.branchCatalog[idx];
    this.mock.setStationSelection({
      id: next.id,
      title: next.title,
      cover: next.cover,
      origin: next.origin,
      sourceType: next.type,
      url: next.url,
    });
    return true;
  }

  /**
   * Route a command to the Playback Orchestrator.
   * Called alongside mock.applyCommand so both state and audio stay in sync.
   * The Orchestrator is the only caller of MpvManager — this class never touches MPV directly.
   */
  private routeToOrchestrator(cmd: string, payload: unknown): void {
    const orch = this.orchestrator;
    if (!orch) {
      console.warn("[DeviceWsManager] routeToOrchestrator: no orchestrator for cmd", cmd);
      return;
    }
    type P = { url?: string; volume?: number; source?: { url?: string } };
    const p = payload as P | null | undefined;

    switch (cmd) {
      case "PLAY": {
        const url = (p?.url ?? "").trim();
        if (url) {
          // Explicit URL in command payload (e.g. remote WS COMMAND with url).
          orch.playMusic(url);
        } else {
          const mpvStatus = orch.getState().music.status;
          if (mpvStatus === "paused") {
            // MPV has a file loaded and is paused — resume in-place.
            orch.resumeMusic();
          } else {
            // MPV is idle or stopped — load from the currently selected source URL.
            const srcUrl = (this.mock.getState().currentSource?.url ?? "").trim();
            if (srcUrl) {
              console.log("[DeviceWsManager] PLAY → loadfile on Channel A:", srcUrl.slice(0, 100));
              orch.playMusic(srcUrl);
            } else {
              // No URL available — best-effort resume (no-op on idle MPV but safe to call).
              orch.resumeMusic();
            }
          }
        }
        break;
      }
      case "PLAY_SOURCE": {
        const url = (p?.source?.url ?? "").trim();
        if (url) orch.playMusic(url);
        break;
      }
      case "PAUSE":
        orch.pauseMusic();
        break;
      case "STOP":
        orch.stopMusic();
        orch.stopInterrupt();
        break;
      case "SET_VOLUME": {
        const vol = p?.volume;
        if (typeof vol === "number" && Number.isFinite(vol)) {
          orch.setVolume(vol);
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Local mock console — same command semantics as incoming WS COMMAND; updates mock and STATE_UPDATE when MASTER.
   */
  applyLocalMockTransport(payload: LocalMockTransportPayload): void {
    const { command } = payload;
    if (command === "PREV" || command === "NEXT") {
      const moved = this.navigateCatalogStep(command);
      if (moved) this.lastCommandSummary = command;
      this.push();
      this.sendStateUpdateIfMaster();
      return;
    }
    let transportPayload: unknown = undefined;
    if (command === "SET_VOLUME") {
      const v = payload.volume;
      if (typeof v !== "number" || !Number.isFinite(v)) {
        this.push();
        return;
      }
      transportPayload = { volume: v };
    }
    const applied = this.mock.applyCommand(command, transportPayload);
    if (applied) {
      this.lastCommandSummary = command;
    }
    this.routeToOrchestrator(command, transportPayload);
    this.push();
    this.sendStateUpdateIfMaster();
  }

  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.wsState = "disconnected";
    this.registered = false;
    this.deviceRole = "unknown";
    this.mock.reset();
    this.branchCatalog = [];
    this.push();
  }

  connect(): void {
    this.disconnect();
    const { wsUrl, wsToken, deviceId, branchId } = this.config;
    const url = (wsUrl ?? "").trim();
    const token = (wsToken ?? "").trim();
    const dev = (deviceId ?? "").trim();
    const branch = (branchId ?? "").trim() || "default";

    if (!url) {
      this.lastError = "WebSocket URL is required.";
      this.wsState = "error";
      this.push();
      return;
    }
    if (!token) {
      this.lastError = "WebSocket token is required (use Sign in below or paste a token from the web app).";
      this.wsState = "error";
      this.push();
      return;
    }
    if (!dev) {
      this.lastError = "Device ID is required.";
      this.wsState = "error";
      this.push();
      return;
    }

    this.lastError = null;
    this.registered = false;
    this.deviceRole = "unknown";
    this.mock.reset();
    this.wsState = "connecting";
    this.push();

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.wsState = "error";
      this.push();
      return;
    }

    this.ws = socket;

    socket.on("open", () => {
      const msg = {
        type: "REGISTER" as const,
        role: "device" as const,
        authToken: token,
        deviceId: dev,
        branchId: branch,
        isMobile: false,
        registrationIntent: registrationIntentBranchDesktopApp(),
      };
      socket.send(JSON.stringify(msg));
    });

    socket.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf-8");
      const p = parseIncoming(raw);
      this.lastServerMessageType = p.type;

      if (p.type === "SET_DEVICE_MODE" && p.mode) {
        this.deviceRole = p.mode;
        this.sendStateUpdateIfMaster();
      }

      if (p.type === "REGISTERED") {
        this.registered = true;
        this.wsState = "connected";
      }

      if (p.type === "COMMAND" && p.command !== undefined) {
        const cmd = p.command;
        if (this.deviceRole === "MASTER") {
          if (cmd === "PREV" || cmd === "NEXT") {
            const moved = this.navigateCatalogStep(cmd);
            if (moved) this.lastCommandSummary = cmd;
            this.sendStateUpdateIfMaster();
          } else {
            const applied = this.mock.applyCommand(cmd, p.payload);
            this.lastCommandSummary = applied ? cmd : `${cmd} (not handled in mock)`;
            this.routeToOrchestrator(cmd, p.payload);
            this.sendStateUpdateIfMaster();
          }
        } else {
          this.lastCommandSummary = `${cmd} (device is ${this.deviceRole} — commands go to MASTER only)`;
        }
      }

      if (p.type === "ERROR") {
        this.lastError = p.message ?? raw.slice(0, 200);
        this.wsState = "error";
      }

      this.push();
    });

    socket.on("close", () => {
      if (this.ws === socket) {
        this.ws = null;
        this.wsState = "disconnected";
        this.registered = false;
        this.deviceRole = "unknown";
        this.mock.reset();
        this.branchCatalog = [];
        this.push();
      }
    });

    socket.on("error", (err) => {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.wsState = "error";
      this.push();
    });
  }
}
