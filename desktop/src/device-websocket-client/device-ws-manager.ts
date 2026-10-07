/**
 * Device WebSocket client — runs in the Electron main process (Node).
 * Protocol aligned with server/index.ts + lib/remote-control/types (REGISTER as device).
 */

import WebSocket from "ws";
import { nextMainWsAttemptId } from "../main/main-attempt-id";
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
import {
  readDesignationRecord,
  writeDesignationRecord,
  clearDesignationRecord,
  isDesignatedStationOffline,
} from "../main/designation-cache";

type StatusListener = (s: MvpStatusSnapshot) => void;

type ParsedIncoming = {
  type: string;
  mode?: MvpDeviceRole;
  /** SET_DEVICE_MODE permanent-designation flag: true/false from the server; undefined on older servers. */
  designated?: boolean;
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
      if (typeof o.designated === "boolean") out.designated = o.designated; // undefined on older servers
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

/**
 * PLAY_INTERRUPT (remote On-Air jingle/announcement) → validated, absolute audio URL for MPV, or null.
 *  - Relative server paths ("/api/jingles/…") resolve against the configured VONO app origin (`apiBaseUrl`) and
 *    must stay on that origin.
 *  - Absolute URLs must be https (http only when it is the configured app origin itself, e.g. local dev).
 *  - LOCAL filesystem paths / file: / local:// / any other scheme are REJECTED — a WS command can never make the
 *    station open a local file.
 * PURE (no MPV / WS / fs) so it is unit-testable.
 */
export function resolveInterruptUrl(raw: unknown, appBaseUrl: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim();
  if (!u || u.length > 2048) return null;
  if (/^[a-zA-Z]:[\\/]/.test(u) || u.startsWith("\\\\") || u.includes("\\")) return null; // Windows / UNC paths
  if (/^(file|local):/i.test(u)) return null;
  let base: URL | null = null;
  try {
    const b = new URL((appBaseUrl ?? "").trim());
    if (b.protocol === "https:" || b.protocol === "http:") base = b;
  } catch {
    base = null;
  }
  if (u.startsWith("/")) {
    if (u.startsWith("//") || !base) return null; // protocol-relative or no configured origin → reject
    try {
      const r = new URL(u, base.origin);
      return r.origin === base.origin ? r.toString() : null;
    } catch {
      return null;
    }
  }
  try {
    const a = new URL(u);
    if (a.protocol === "https:") return a.toString();
    if (a.protocol === "http:" && base && a.origin === base.origin) return a.toString();
    return null;
  } catch {
    return null; // bare relative paths without a leading "/" (e.g. "C:foo", "foo.mp3") are not accepted
  }
}

/**
 * Ordered MPV interrupt URLs for a PLAY_INTERRUPT payload: optional pre-roll bell (when `preRoll` + a safe
 * `bellStyle` other than "off"), then the announcement. Mirrors the renderer browser-MASTER On-Air handler.
 * Returns [] when the payload is invalid (fail-safe: nothing plays).
 */
export function interruptUrlsForPayload(payload: unknown, appBaseUrl: string | undefined): string[] {
  const p = (payload ?? {}) as { url?: unknown; preRoll?: unknown; bellStyle?: unknown };
  const main = resolveInterruptUrl(p.url, appBaseUrl);
  if (!main) return [];
  const style = typeof p.bellStyle === "string" ? p.bellStyle.trim() : "";
  if (p.preRoll === true && style && style !== "off" && /^[a-z0-9_-]{1,32}$/i.test(style)) {
    const bell = resolveInterruptUrl(`/api/jingles/bell/${style}`, appBaseUrl);
    if (bell) return [bell, main];
  }
  return [main];
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
  /**
   * Offline permanent-designation authority. Loaded SYNCHRONOUSLY from the ProgramData cache at construction
   * (before the renderer mounts), then refreshed only by trusted online SET_DEVICE_MODE events. True ⇒ this
   * station may execute LOCAL playback offline even with no WS (co-located renderer reads it via the snapshot).
   */
  private offlineDesignated = false;

  /** Recompute `offlineDesignated` from the persisted cache vs the current durable id + branch. */
  private refreshOfflineDesignated(): void {
    this.offlineDesignated = isDesignatedStationOffline(readDesignationRecord(), {
      durableDeviceId: (this.config.deviceId ?? "").trim(),
      branchId: (this.config.branchId ?? "").trim() || "default",
    });
  }

  constructor(initialConfig: DesktopRuntimeConfig, orchestrator?: PlaybackOrchestrator) {
    this.config = initialConfig;
    this.refreshOfflineDesignated(); // deterministic sync load — available in the very first snapshot
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
    this.refreshOfflineDesignated(); // durable id / branch may have changed
  }

  /**
   * Apply an authoritative SET_DEVICE_MODE permanent-designation signal (approach b).
   *  - MASTER + designated===true  → write/refresh the trusted cache (offline authority).
   *  - CONTROL  OR designated===false → EXPLICIT REVOCATION: clear the cache; and if this station was the
   *    offline-designated player, STOP station audio now (hand off) — stop music + any interrupt.
   *  - designated===undefined (older server / non-flagged MASTER path) → leave the cache UNCHANGED.
   * The stop fires ONLY on explicit revocation of a station that WAS designated; it never touches the normal
   * renderer CONTROL / stopForControlHandoff path and cannot reintroduce the eject bug.
   */
  private applyDesignationSignal(mode: MvpDeviceRole, designated: boolean | undefined): void {
    if (mode === "MASTER" && designated === true) {
      writeDesignationRecord({
        workspaceId: "", // keying only; the trust anchor is the durable id + this verified server event
        branchId: (this.config.branchId ?? "").trim() || "default",
        durableDeviceId: (this.config.deviceId ?? "").trim(),
        designatedAt: Date.now(),
      });
      this.refreshOfflineDesignated();
      return;
    }
    if (mode === "CONTROL" || designated === false) {
      const wasDesignated = this.offlineDesignated;
      clearDesignationRecord();
      this.offlineDesignated = false;
      // Explicit revocation of a station that WAS the designated offline player → stop + hand off.
      if (wasDesignated && this.orchestrator) {
        const st = this.orchestrator.getState().music.status;
        if (st === "playing" || st === "paused") {
          console.warn("[SyncBiz:desktop-mpv] permanent-designation REVOKED → stopping station audio (hand off)");
          this.orchestrator.stopMusic();
          this.orchestrator.stopInterrupt();
        }
      }
      return;
    }
    // designated === undefined on a MASTER signal → no change (never clears a valid cache).
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

  /**
   * Run remote/local transport: MPV (when `orchestrator` is set) is the only source of truth for
   * play state / volume. Avoid optimistic `applyCommand` so STATE_UPDATE and UI do not show
   * "playing" before the engine has actually started (or after failed loadfile).
   */
  private runTransportCommand(cmd: string, payload: unknown, source: "ws" | "local"): void {
    if (this.orchestrator) {
      console.log("[SyncBiz:desktop-mpv:truth] transport (MPV will sync; skipping optimistic applyCommand)", {
        cmd,
        source,
      });
      this.routeToOrchestrator(cmd, payload);
      this.lastCommandSummary = cmd;
    } else {
      const applied = this.mock.applyCommand(cmd, payload);
      this.lastCommandSummary = applied ? cmd : `${cmd} (not handled in mock)`;
      this.routeToOrchestrator(cmd, payload);
    }
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
      // Offline permanent-designation authority (approach b): true ⇒ the co-located renderer may execute LOCAL
      // playback even with no WS. Loaded sync from the ProgramData cache; refreshed only by trusted server events.
      designatedStationOffline: this.offlineDesignated,
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
      mpvEngineReady: orchState?.music.engineReady ?? false,
      mpvLastError: orchState?.music.lastError ?? st.mpvEngineError ?? null,
      mpvAttemptId: orchState?.music.attemptId ?? 0,
      mpvAttemptMode: orchState?.music.attemptMode ?? "cold",
      // Live media identity (hash only) — lets a renderer remount prove it re-owns the SAME media before
      // adopting the running engine (no restart). Never a raw URL/path, so safe in any status payload.
      mpvCurrentMediaKey: orchState?.currentMediaKey ?? "",
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
      console.warn("[SyncBiz:desktop-mpv:route] no orchestrator; command dropped", { cmd });
      return;
    }
    console.log("[SyncBiz:desktop-mpv:route] command → PlaybackOrchestrator (music Ch-A)", { cmd });
    type P = { url?: string; volume?: number; source?: { url?: string } };
    const p = payload as P | null | undefined;

    switch (cmd) {
      case "PLAY": {
        const url = (p?.url ?? "").trim();
        const fadeSec = orch.getCrossfadeSec();
        if (url) {
          if (orch.getState().music.status === "playing") {
            orch.playMusicCrossfade(url, fadeSec, nextMainWsAttemptId());
          } else {
            orch.playMusic(url, nextMainWsAttemptId());
          }
        } else {
          const mpvStatus = orch.getState().music.status;
          if (mpvStatus === "paused") {
            orch.resumeMusic();
          } else {
            const srcUrl = (this.mock.getState().currentSource?.url ?? "").trim();
            if (srcUrl) {
              console.log("[DeviceWsManager] PLAY → loadfile on Channel A:", srcUrl.slice(0, 100));
              if (mpvStatus === "playing") {
                orch.playMusicCrossfade(srcUrl, fadeSec, nextMainWsAttemptId());
              } else {
                orch.playMusic(srcUrl, nextMainWsAttemptId());
              }
            } else {
              orch.resumeMusic();
            }
          }
        }
        break;
      }
      case "PLAY_SOURCE": {
        // METADATA FIRST — always populate the station session (title/artwork/queue/index) from the
        // payload so STATE_UPDATE mirrors it to CONTROL, INCLUDING a local playlist whose track urls were
        // stripped on the wire (top-level url empty). This is metadata-only; it never triggers playback.
        const srcMeta = (payload as {
          source?: {
            id?: unknown; title?: unknown; cover?: unknown; type?: unknown;
            origin?: unknown; url?: unknown; playlistId?: unknown;
            sessionTracks?: Array<{ id?: unknown; title?: unknown; cover?: unknown; durationSeconds?: unknown }>;
          };
          trackIndex?: unknown;
        } | null | undefined);
        const src = srcMeta?.source;
        if (src && typeof src.id === "string" && src.id.trim()) {
          const origin = src.origin === "playlist" || src.origin === "radio" || src.origin === "source" ? src.origin : undefined;
          const tracks = Array.isArray(src.sessionTracks)
            ? src.sessionTracks
                .filter((t) => t && typeof t.id === "string")
                .map((t) => ({
                  id: String(t.id),
                  title: typeof t.title === "string" ? t.title : "",
                  cover: typeof t.cover === "string" ? t.cover : null,
                  ...(typeof t.durationSeconds === "number" ? { durationSeconds: t.durationSeconds } : {}),
                }))
            : undefined;
          this.mock.setStationSession({
            id: src.id,
            title: typeof src.title === "string" ? src.title : "",
            cover: typeof src.cover === "string" ? src.cover : null,
            origin,
            sourceType: typeof src.type === "string" ? src.type : undefined,
            url: typeof src.url === "string" ? src.url : undefined,
            trackIndex: typeof srcMeta?.trackIndex === "number" ? srcMeta.trackIndex : 0,
            sessionTitle: typeof src.title === "string" ? src.title : null,
            sessionPlaylistId: typeof src.playlistId === "string" ? src.playlistId : null,
            sessionTracks: tracks,
          });
        }
        const url = (p?.source?.url ?? "").trim();
        if (!url) break; // local (paths stripped on the wire) → audio handled by the co-located renderer engine
        const fadeSec = orch.getCrossfadeSec();
        if (orch.getState().music.status === "playing") {
          orch.playMusicCrossfade(url, fadeSec, nextMainWsAttemptId());
        } else {
          orch.playMusic(url, nextMainWsAttemptId());
        }
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
      case "PLAY_INTERRUPT": {
        // Remote On-Air jingle/announcement for the designated station (MAIN = branch MASTER since PR #50).
        // Hands the validated URL(s) to the EXISTING interrupt channel (duck → play once → restore). Music
        // channel, queue/session and designation are untouched. Invalid / local-path payloads play nothing.
        const urls = interruptUrlsForPayload(payload, this.config.apiBaseUrl);
        if (urls.length === 0) {
          console.warn("[SyncBiz:desktop-mpv:route] PLAY_INTERRUPT rejected (invalid or non-server URL)");
          break;
        }
        for (const u of urls) orch.playInterrupt(u);
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
    console.log("[SyncBiz:desktop-mpv:route] localMockTransport (same semantics as remote COMMAND)", { command });
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
    this.runTransportCommand(command, transportPayload, "local");
    this.push();
    this.sendStateUpdateIfMaster();
  }

  // ── Auto-reconnect (P0: MAIN durable WS must recover after an abnormal/network disconnect without an app
  // restart) ───────────────────────────────────────────────────────────────────────────────────────────
  // `intentionalClose` distinguishes a deliberate disconnect (shutdown / sign-out / WS_DISCONNECT) — which must
  // NOT reconnect — from an abnormal socket close (network/WS outage) — which MUST keep retrying. Reconnect uses
  // the SAME authenticated station identity from `this.config` (durable deviceId + latest wsToken); it never mints
  // a new identity, never alters MASTER/designation semantics, and never touches the orchestrator/MPV, so current
  // LOCAL audio keeps playing throughout. A single pending timer + the clean-slate teardown in connect() prevent
  // duplicate sockets/timers.
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Schedule a reconnect after an ABNORMAL close. Bounded exponential backoff + jitter, capped at 30s, retried
   *  indefinitely (long outages never give up). No-op when an intentional close is in effect, a timer is already
   *  pending, or a socket is already OPEN/CONNECTING — so there is never a duplicate socket or timer. */
  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    if (this.reconnectTimer) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const attempt = this.reconnectAttempt;
    const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)); // 1,2,4,8,16,30,30,…
    const delay = base + Math.floor(Math.random() * 1_000); // jitter avoids thundering herd across a fleet
    this.reconnectAttempt = attempt + 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalClose) return;
      this.connect(); // reuses this.config (durable id + latest token); tears down any stale socket first
    }, delay);
  }

  /**
   * Tear down the current socket + WS-registration state. `resetSession` controls PLAYBACK TRUTH:
   *  - true  (INTENTIONAL disconnect: shutdown / sign-out / WS_DISCONNECT) → clear the mock session.
   *  - false (TRANSPORT drop / reconnect) → PRESERVE the mock session (status/position/currentSource). A network
   *    blip must NEVER mutate playback truth; the orchestrator keeps feeding real MPV state via syncMpvStatus, so
   *    broadcasting a reset "idle" here is a FALSE EOF the renderer would act on (CHAIN A). Preserving it means the
   *    renderer keeps seeing the true "playing" state across the outage.
   */
  private teardownSocket(resetSession: boolean): void {
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
    if (resetSession) this.mock.reset();
    this.branchCatalog = [];
    this.push();
  }

  disconnect(): void {
    // Deliberate disconnect → cancel auto-reconnect and clear the session. removeAllListeners() (in teardownSocket)
    // means the socket's own close handler will NOT fire, so this can never schedule a reconnect.
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.teardownSocket(true);
  }

  connect(): void {
    // Clean slate for a (re)connect — TRANSPORT teardown that PRESERVES playback truth (never a false idle).
    this.teardownSocket(false);
    // This is a LIVE connect attempt → re-enable auto-reconnect for the socket we are about to open.
    this.intentionalClose = false;
    this.clearReconnectTimer();
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
    // NOTE: deliberately NO mock session reset here — a (re)connect must not wipe playback truth to a false idle
    // (CHAIN A). The session is reconciled by the server's post-REGISTER STATE and by live syncMpvStatus.
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
      this.reconnectAttempt = 0; // successful connection → reset backoff for any future outage
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
        this.applyDesignationSignal(p.mode, p.designated); // trusted cache write/clear + revocation stop
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
            this.runTransportCommand(cmd, p.payload, "ws");
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
        // CHAIN A: do NOT reset the mock session on a transport close — a reset broadcasts a false "idle" playback
        // status (with the live MPV attempt id) that the renderer misreads as a natural EOF → spurious next().
        // Playback truth stays owned by the orchestrator (syncMpvStatus); a network drop never mutates it.
        this.branchCatalog = [];
        this.push();
      }
      // ABNORMAL close (network/WS outage): the listeners are still attached (a deliberate disconnect() removes
      // them first), so keep the permanent station alive by auto-reconnecting. Never touches MPV/orchestrator, so
      // current LOCAL audio is unaffected. Stale sockets (this.ws !== socket) still schedule — scheduleReconnect()
      // self-guards against duplicates and against an already-live socket.
      if (!this.intentionalClose) this.scheduleReconnect();
    });

    socket.on("error", (err) => {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.wsState = "error";
      this.push();
    });
  }
}
