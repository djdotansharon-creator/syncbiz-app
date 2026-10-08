/**
 * Device WebSocket client — runs in the Electron main process (Node).
 * Protocol aligned with server/index.ts + lib/remote-control/types (REGISTER as device).
 */

import WebSocket from "ws";
import { nextMainWsAttemptId } from "../main/main-attempt-id";
import { MockPlaybackSession } from "../playback-agent";
import type { StationSessionMeta } from "../playback-agent/mock-playback-session";
import {
  MAX_AUTO_FAILURES, PREPARE_LEAD_SEC, buildQueueItems, buildUrlSession, nextAutoIndex, sourceIdFor,
  type QueueItem, type RepeatMode, type UrlSession,
} from "./url-auto-advance";
import { isMainWsAttemptId } from "../main/main-attempt-id";
import { readPlaybackSource, writePlaybackSource, type SavedUrlSession } from "../main/playback-source-store";

/** P0 Drop Next: the next thing MAIN plays automatically — a queued item, or a URL playlist index. */
type AutoTarget = { kind: "queue"; item: QueueItem } | { kind: "playlist"; index: number };
/** Cap for MAIN's Play Next queue (a dropped huge playlist never grows memory without bound). */
const MAX_PLAY_NEXT = 500;
import { fileLog } from "../main/file-logger";

// P0 Gate 2c: the user's AUTOMIX + loop setting (pushed by the co-located renderer; module-level so a re-created
// manager keeps them). Defaults = the renderer's defaults until the first push.
let urlAutoMixPref = false;
let urlRepeatModePref: RepeatMode = "playlist";
export function setUrlPlaybackPrefs(p: { autoMix?: unknown; repeatMode?: unknown }): void {
  if (typeof p.autoMix === "boolean") urlAutoMixPref = p.autoMix;
  if (p.repeatMode === "playlist" || p.repeatMode === "track" || p.repeatMode === "off") urlRepeatModePref = p.repeatMode;
}
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
  /** P0 Gate 1a: (source id # trackIndex) of the last WS URL load — a duplicate PLAY_SOURCE for it is ignored while pending. */
  private pendingWsLoadKey: string | null = null;
  /**
   * P0 Gate 1f: the session metadata that was published (and audible) when a STANDBY URL load began. If that standby
   * attempt fails / is abandoned while the old deck stays audible, the session is restored so no controller shows the
   * failed item over the old music. Metadata only — MPV / decks / crossfade are never touched.
   */
  private preLoadSession: { attemptId: number; session: StationSessionMeta } | null = null;
  // ── P0 Gate 2c: MAIN owns the AUTOMATIC progression of the URL session it is playing (url-auto-advance.ts) ──
  private urlSession: UrlSession | null = null;
  /** the next item prepared (paused + silent) on the standby deck for the attempt now playing */
  private autoPrep: { forAttempt: number; target: AutoTarget; preparedAttemptId: number } | null = null;
  /** the last hand-over / MAIN navigation, kept until its attempt is proven — a failure rolls the session back */
  private autoCommit: { prevAttemptId: number; prevIndex: number; prevQueuedNow: QueueItem | null; attemptId: number; target: AutoTarget; manual?: boolean } | null = null;
  // ── P0 Drop Next: MAIN's Play Next queue (URLs only) ──
  private playNext: QueueItem[] = [];
  private playNextSeq = 0;
  /** the queued item MAIN is playing now (null = a playlist item / LOCAL) */
  private queuedNow: QueueItem | null = null;
  /** LOCAL session: the attempt MAIN watches while the renderer's LOCAL track yields its next slot to the queue */
  private localQueueWatch = 0;
  private autoFailed = new Set<number>();
  private autoFailures = 0;
  private autoEofHandledFor = 0;
  private sessionPlayedFor = 0;
  private autoAttemptIds: number[] = [];
  private inAutoTick = false;
  // ── P0 Gate 2d: restart restore — the station keeps its LAST source (no age limit) ──
  private sourcePersist = false;
  /** what the station boots into (renderer waits for this before its own LOCAL restore) */
  private bootSource: "none" | "deciding" | "url" | "url-pending" | "url-failed" | "local" = "none";
  /** saved URL session waiting for the network (offline boot → LOCAL fallback meanwhile) */
  private pendingRestore: SavedUrlSession | null = null;
  /** the saved URL session is armed over the LOCAL fallback: taken over at the LOCAL track's mix point */
  private restoreDormant = false;
  /** the MAIN attempt that took over from the LOCAL fallback (the renderer then releases LOCAL ownership) */
  private restoreTakeoverAttemptId = 0;
  private restoreStartWhenReady = false;
  private restoreNetTimer: ReturnType<typeof setInterval> | null = null;
  private restoreNetOk = 0;
  /** P0 Gate 2d (owner rule 2026-10-09): the restored URL session has not played yet. Until it does, a failure must
   *  never leave silence — LOCAL plays and the URL is retried over it (at the LOCAL mix point), or dropped. */
  private restoreVerifying = false;
  private restoreFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private probeUrl = "";
  // P0 Gate 1d: remote NEXT / PREV relay identity (see MvpStatusSnapshot.sessionStep*).
  private readonly sessionStepBootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  private sessionStepSeq = 0;
  private sessionStepDirection: "next" | "prev" | "jump" | null = null;
  private sessionStepIndex: number | null = null;
  private sessionStepSessionId: string | null = null;
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
        this.mock.setAttemptPending(this.attemptPending()); // P0 Gate 1f (read-only)
        this.settlePreLoadSession(s.music); // P0 Gate 1f
        if (this.restoreStartWhenReady && s.music?.engineReady) this.startRestoredItem("boot (engine ready)"); // P0 Gate 2d
        this.urlAutoAdvanceTick(s.music); // P0 Gate 2c
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
      sessionStepBootId: this.sessionStepBootId,
      sessionStepSeq: this.sessionStepSeq,
      sessionStepDirection: this.sessionStepDirection,
      sessionStepIndex: this.sessionStepIndex,
      sessionStepSessionId: this.sessionStepSessionId,
      mpvAttemptPending: this.attemptPending(), // P0 Gate 1f (read-only)
      mainUrlAutoAdvance: this.mainOwnsAutoAdvance(), // P0 Gate 2c
      // P0 Drop Next (LOCAL session): MAIN plays a queued item / the renderer must take the slot back after it
      mainQueuePlaying: !!this.queuedNow && this.currentAttemptIs(this.watchedAttempt()),
      queueReturnToLocal: !this.urlSession && !!this.queuedNow && this.playNext.length === 0 && this.currentAttemptIs(this.watchedAttempt()),
      queueWatchesLocal: (!this.urlSession || this.restoreDormant) && !this.queuedNow && (this.playNext.length > 0 || this.restoreDormant) && this.localQueueWatch > 0 && this.currentAttemptIs(this.localQueueWatch),
      bootSource: this.bootSource, // P0 Gate 2d
      restoreTakeoverAttemptId: this.restoreTakeoverAttemptId, // P0 Gate 2d
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

  /**
   * P0 Gate 1d: WS NEXT / PREV. While a station session exists, the co-located renderer OWNS it (URL session index /
   * LOCAL queue) → relay ONE step request (new seq) to it via the status snapshot; MAIN metadata is NOT touched here
   * (it changes only when the renderer actually steps: PLAY_SOURCE / LOCAL session sync). No session → the existing
   * catalog step (nothing audible to diverge from).
   */
  private handleRemoteStep(cmd: "PREV" | "NEXT"): void {
    if (this.mainNav(cmd)) return; // P0 Drop Next: MAIN's own URL session / queued item → MAIN steps it
    if (this.mock.getState().currentSource) {
      this.sessionStepSeq += 1;
      this.sessionStepDirection = cmd === "NEXT" ? "next" : "prev";
      this.lastCommandSummary = `${cmd} (relayed to station renderer #${this.sessionStepSeq})`;
      console.log("[VONO step-relay] WS " + cmd + " → renderer step request", { seq: this.sessionStepSeq });
      return; // the caller pushes the snapshot (delivers the request)
    }
    const moved = this.navigateCatalogStep(cmd);
    if (moved) this.lastCommandSummary = cmd;
    this.sendStateUpdateIfMaster();
  }

  /**
   * P0 Gate 1e: WS JUMP_SESSION_INDEX (a remote's absolute session-row selection) → relay ONE indexed jump request to
   * the station renderer (the URL session owner — it alone holds the track URLs) with the same exactly-once identity
   * as NEXT / PREV. MAIN metadata is NOT touched; it changes only when the renderer sends the exact PLAY_SOURCE.
   * Invalid payload or no session → ignored (no catalog change).
   */
  private handleRemoteJump(payload: unknown): void {
    const j = payload as { trackIndex?: unknown; sessionSourceId?: unknown } | null | undefined;
    const idx = typeof j?.trackIndex === "number" && Number.isInteger(j.trackIndex) && j.trackIndex >= 0 ? j.trackIndex : null;
    const sid = typeof j?.sessionSourceId === "string" && j.sessionSourceId.trim() ? j.sessionSourceId.trim() : null;
    if (idx === null || sid === null || !this.mock.getState().currentSource) {
      this.lastCommandSummary = "JUMP_SESSION_INDEX ignored (invalid / no session)";
      return;
    }
    this.sessionStepSeq += 1;
    this.sessionStepDirection = "jump";
    this.sessionStepIndex = idx;
    this.sessionStepSessionId = sid;
    this.lastCommandSummary = `JUMP_SESSION_INDEX ${idx} (relayed to station renderer #${this.sessionStepSeq})`;
    console.log("[VONO step-relay] WS JUMP_SESSION_INDEX → renderer jump request", { seq: this.sessionStepSeq, trackIndex: idx });
  }

  /**
   * P0 Gate 1f: settle the remembered pre-load session against MAIN's status for THAT standby attempt:
   * failed (idle + error) → restore the audible session (metadata only); ready (no longer pending, playing, no error)
   * → the new session is real (forget). Any other attempt → untouched.
   */
  private settlePreLoadSession(music: { attemptId?: number; status?: string; lastError?: string | null }): void {
    const pre = this.preLoadSession;
    if (!pre || music.attemptId !== pre.attemptId) return;
    if (music.status === "idle" && music.lastError) { this.restorePreLoadSession("standby attempt failed"); return; }
    if (music.status === "playing" && !music.lastError && this.orchestrator !== null && !this.attemptPending()) this.preLoadSession = null;
  }

  // ── P0 Gate 2c + Drop Next: automatic progression (URL session + Play Next queue) ─────────────────────────────

  private resetAutoAdvance(): void {
    this.autoPrep = null;
    this.autoCommit = null;
    this.autoFailed.clear();
    this.autoFailures = 0;
    this.autoEofHandledFor = 0;
    this.sessionPlayedFor = 0;
  }

  private rememberAutoAttempt(id: number): void {
    this.autoAttemptIds.push(id);
    if (this.autoAttemptIds.length > 64) this.autoAttemptIds.shift();
  }

  /** The attempt whose end drives the next automatic step: the URL session item / a queued item / a LOCAL renderer
   *  attempt that yields its next slot to the Play Next queue. */
  private watchedAttempt(): number {
    return this.urlSession && !this.restoreDormant ? this.urlSession.attemptId : this.localQueueWatch;
  }

  /** Publish item `sess.index` as the station session (metadata only; the audio was already handed over / loaded). */
  private publishSessionItem(sess: UrlSession): void {
    const it = sess.items[sess.index];
    if (!it) return;
    const cur = this.mock.getState();
    this.mock.setStationSession({
      id: sourceIdFor(sess, sess.index),
      title: it.title,
      cover: it.cover,
      origin: sess.origin,
      sourceType: sess.sourceType,
      url: it.url,
      trackIndex: sess.index,
      sessionTitle: cur.sessionTitle ?? sess.sessionTitle,
      sessionPlaylistId: sess.sessionPlaylistId,
      sessionTracks: sess.items.map((t) => ({ id: t.id, title: t.title, cover: t.cover, ...(typeof t.durationSeconds === "number" ? { durationSeconds: t.durationSeconds } : {}) })),
    });
    this.pendingWsLoadKey = `${sourceIdFor(sess, sess.index)}#${sess.index}`;
  }

  /** Drop Next: publish MAIN's queue to every controller (metadata only — URLs never leave MAIN through the mirror). */
  private publishQueue(): void {
    this.mock.setPlayNextQueue(this.playNext.map((q) => ({ id: q.qid, title: q.title, cover: q.cover })));
  }

  /** What plays next: the Play Next queue first, then the URL playlist (LOCAL parity loop rule). Manual NEXT treats
   *  loop "track" as "playlist" (as the renderer always did). */
  private nextTarget(manual: boolean): AutoTarget | null {
    if (this.playNext.length > 0) return { kind: "queue", item: this.playNext[0] };
    const sess = this.urlSession;
    if (!sess) return null;
    // P0 Gate 2d: the saved URL session armed over the LOCAL fallback resumes at the item it was playing
    if (this.restoreDormant) {
      const n = sess.items.length;
      for (let k = 0; k < n; k++) { const i = (sess.index + k) % n; if (sess.items[i]?.url && !this.autoFailed.has(i)) return { kind: "playlist", index: i }; }
      return null;
    }
    const rm: RepeatMode = manual && urlRepeatModePref === "track" ? "playlist" : urlRepeatModePref;
    const ni = nextAutoIndex(sess, rm, this.autoFailed);
    return ni === null ? null : { kind: "playlist", index: ni };
  }

  private targetUrl(t: AutoTarget): string {
    return t.kind === "queue" ? t.item.url : (this.urlSession?.items[t.index]?.url ?? "");
  }

  private sameTarget(a: AutoTarget | null, b: AutoTarget | null): boolean {
    if (!a || !b || a.kind !== b.kind) return false;
    return a.kind === "queue" ? a.item.qid === (b as { item: QueueItem }).item.qid : a.index === (b as { index: number }).index;
  }

  /** Make `t` the item MAIN plays now (metadata + session position). A queued item leaves the queue; the playlist
   *  position is kept so the playlist resumes exactly where it stopped once the queue is empty. */
  private applyTarget(t: AutoTarget, attemptId: number): void {
    if (t.kind === "queue") {
      this.playNext = this.playNext.filter((q) => q.qid !== t.item.qid);
      this.queuedNow = t.item;
      this.mock.setQueuedNowPlaying({ id: t.item.qid, title: t.item.title, cover: t.item.cover, url: t.item.url });
      this.pendingWsLoadKey = `${t.item.qid}#0`;
    } else if (this.urlSession) {
      this.queuedNow = null;
      this.urlSession.index = t.index;
      this.publishSessionItem(this.urlSession);
      if (this.restoreDormant) {
        // P0 Gate 2d: the saved URL session takes over from the LOCAL fallback — the renderer releases LOCAL
        this.restoreDormant = false;
        this.restoreTakeoverAttemptId = attemptId;
        this.bootSource = "url"; // the LOCAL fallback stays "url-pending" (renderer keeps LOCAL) until this take-over
        this.localQueueWatch = 0;
        fileLog("INFO", "RESTORE_URL_TAKEOVER", { index: t.index, attemptId });
      }
    }
    if (this.urlSession && !this.restoreDormant) this.urlSession.attemptId = attemptId;
    else this.localQueueWatch = attemptId;
    this.publishQueue();
    this.persistUrl(); // P0 Gate 2d
  }

  private urlAutoAdvanceTick(music: { attemptId?: number; status?: string; position?: number; duration?: number; lastError?: string | null }): void {
    const orch = this.orchestrator;
    if (!orch || this.inAutoTick) return;
    if (!this.urlSession && this.playNext.length === 0 && !this.queuedNow) return;
    this.inAutoTick = true;
    try {
      this.autoTick(orch, music);
    } finally {
      this.inAutoTick = false;
    }
  }

  private autoTick(orch: PlaybackOrchestrator, m: { attemptId?: number; status?: string; position?: number; duration?: number; lastError?: string | null }): void {
    const id = typeof m.attemptId === "number" ? m.attemptId : 0;
    // (0) LOCAL session (renderer-owned): the renderer took the slot back (its own LOCAL attempt plays again) → clear
    //     the queue context; while items are queued, watch the LOCAL attempt now playing (it yields its next slot).
    if ((!this.urlSession || this.restoreDormant) && id > 0 && !isMainWsAttemptId(id) && m.status === "playing" && (m.position ?? 0) > 0) {
      if (this.queuedNow) { this.queuedNow = null; this.localQueueWatch = 0; this.autoPrep = null; }
      if ((this.playNext.length > 0 || this.restoreDormant) && this.localQueueWatch !== id) { this.localQueueWatch = id; this.autoPrep = null; }
    }
    const watched = this.watchedAttempt();
    // (a) a hand-over failed and MAIN reports the still-audible deck again (Gate 2a) → roll back, skip that item
    const c = this.autoCommit;
    if (c && watched === c.attemptId && id === c.prevAttemptId && m.status === "playing") {
      if (this.urlSession) { this.urlSession.attemptId = c.prevAttemptId; this.urlSession.index = c.prevIndex; }
      else this.localQueueWatch = c.prevAttemptId;
      this.queuedNow = c.prevQueuedNow;
      if (c.target.kind === "playlist") this.autoFailed.add(c.target.index); // a failed queued item already left the queue
      this.autoFailures += 1;
      this.autoCommit = null;
      this.autoPrep = null;
      this.publishQueue();
      fileLog("WARN", "URL_AUTO_COMMIT_FAILED", { target: c.target.kind, failedAttemptId: c.attemptId, audibleAttemptId: id, consecutiveFailures: this.autoFailures });
      // P0 Gate 2d: an unproven restore whose take-over from LOCAL failed → LOCAL (still audible) stays the station's audio
      if (this.restoreVerifying && !isMainWsAttemptId(id)) { this.restoreFailOver(orch, "take-over from LOCAL failed"); return; }
      // a failed MANUAL NEXT / PREV → try the following item ONCE more (Gate 1b rule), the audible track untouched
      if (c.manual && this.autoFailures < MAX_AUTO_FAILURES) this.navLoad(orch, this.nextTarget(true), "NEXT", "after a failed navigation");
      return;
    }
    if (id === 0 || id !== watched) return;
    // (b) MAIN's own automatic attempt (or the watched LOCAL attempt) failed → fail forward (capped)
    if (m.status === "idle" && m.lastError) {
      const mine = this.autoAttemptIds.includes(id) || (!this.urlSession && id === this.localQueueWatch);
      if (mine && this.autoEofHandledFor !== id) {
        this.autoEofHandledFor = id;
        if (this.autoCommit?.attemptId === id) {
          // A hand-over failed. If the outgoing deck is still audible, MAIN reports it right after this event (Gate 2a)
          // and (a) rolls back. Only if NOTHING is audible do we fail forward — decided once this event has settled.
          queueMicrotask(() => {
            const o2 = this.orchestrator;
            if (!o2 || this.watchedAttempt() !== id || o2.getState().music.attemptId !== id || this.inAutoTick) return;
            this.inAutoTick = true;
            try {
              const cc = this.autoCommit;
              this.autoCommit = null;
              if (cc?.target.kind === "playlist") this.autoFailed.add(cc.target.index);
              this.autoFailures += 1;
              if (this.restoreVerifying) this.restoreFailOver(o2, "hand-over failed (nothing audible)"); // P0 Gate 2d
              else this.autoLoadNext(o2, "hand-over failed (nothing audible)");
            } finally {
              this.inAutoTick = false;
            }
          });
          return;
        }
        if (this.urlSession && !this.queuedNow) this.autoFailed.add(this.urlSession.index);
        this.autoFailures += 1;
        // P0 Gate 2d: an unproven restore never keeps retrying in silence → LOCAL now, the URL retried over it
        if (this.restoreVerifying && !this.restoreDormant) this.restoreFailOver(orch, "restored item failed");
        else this.autoLoadNext(orch, "attempt failed");
      }
      return;
    }
    if (m.status === "playing" && (m.position ?? 0) > 0) {
      this.sessionPlayedFor = id;
      if (this.restoreVerifying && !this.restoreDormant && isMainWsAttemptId(id) && !orch.isMusicAttemptPending()) {
        this.restoreVerifying = false; // P0 Gate 2d: the restored URL source really plays
        this.clearRestoreFallbackTimer();
        fileLog("INFO", "RESTORE_URL_PROVEN", { attemptId: id });
      }
      if (this.autoCommit?.attemptId === id && !orch.isMusicAttemptPending()) {
        this.autoCommit = null; // the hand-over is proven
        this.autoFailures = 0;
        this.autoFailed.clear();
      }
    }
    // (c) natural end with no hand-over yet (the next item was not ready in time) → continue NOW, never silence
    if (m.status === "idle" && !m.lastError && this.sessionPlayedFor === id && this.autoEofHandledFor !== id) {
      this.autoEofHandledFor = id;
      const ap = this.autoPrep;
      if (ap && ap.forAttempt === id && this.sameTarget(ap.target, this.nextTarget(false)) && orch.commitPreparedCrossfade(1)) { this.afterAutoCommit(ap); return; }
      this.autoLoadNext(orch, "natural end");
      return;
    }
    if (m.status !== "playing" || !(typeof m.duration === "number" && m.duration > 0) || orch.isMusicAttemptPending()) return;
    const remaining = m.duration - (m.position ?? 0);
    // (d) prepare the next item ~PREPARE_LEAD_SEC before the end (paused + silent → resolved + buffered)
    if (!this.autoPrep || this.autoPrep.forAttempt !== id) {
      if (remaining <= PREPARE_LEAD_SEC && this.autoFailures < MAX_AUTO_FAILURES) {
        const t = this.nextTarget(false);
        const url = t ? this.targetUrl(t) : "";
        if (t && url) {
          const pid = nextMainWsAttemptId();
          if (orch.prepareStandby(url, pid)) {
            this.autoPrep = { forAttempt: id, target: t, preparedAttemptId: pid };
            this.rememberAutoAttempt(pid);
            fileLog("INFO", "URL_AUTO_PREPARE", { forAttempt: id, target: t.kind, nextIndex: t.kind === "playlist" ? t.index : null, attemptId: pid, remainingSec: Math.round(remaining) });
          }
        }
      }
      return;
    }
    // the queue changed under a prepared item (removed / a new item dropped in front of a playlist item) → re-prepare
    if (!this.sameTarget(this.autoPrep.target, this.nextTarget(false))) {
      orch.discardPrepared();
      this.autoPrep = null;
      return;
    }
    const prep = orch.getPrepared();
    if (!prep || prep.attemptId !== this.autoPrep.preparedAttemptId) { this.autoPrep = null; return; } // superseded
    if (prep.failed) {
      const t = this.autoPrep.target;
      fileLog("WARN", "URL_AUTO_PREPARE_FAILED", { target: t.kind, attemptId: prep.attemptId });
      if (t.kind === "queue") { this.playNext = this.playNext.filter((q) => q.qid !== t.item.qid); this.publishQueue(); }
      else this.autoFailed.add(t.index);
      this.autoFailures += 1;
      orch.discardPrepared();
      this.autoPrep = null; // the following item is prepared on the next tick (capped)
      if (this.restoreVerifying && this.autoFailures >= MAX_AUTO_FAILURES) this.restoreGiveUp("prepared items failed"); // P0 Gate 2d
      return;
    }
    // (e) mix point → hand the prepared item over (AUTOMIX on: the user's mix length; off: a quick 1 s change at the end)
    const mixSec = urlAutoMixPref ? orch.getCrossfadeSec() : 1;
    if (prep.ready && remaining <= mixSec) {
      const ap = this.autoPrep;
      if (orch.commitPreparedCrossfade(mixSec)) this.afterAutoCommit(ap);
    }
  }

  private afterAutoCommit(ap: { forAttempt: number; target: AutoTarget; preparedAttemptId: number }): void {
    const before = this.mock.captureSession();
    this.autoCommit = { prevAttemptId: this.watchedAttempt(), prevIndex: this.urlSession?.index ?? 0, prevQueuedNow: this.queuedNow, attemptId: ap.preparedAttemptId, target: ap.target };
    this.autoPrep = null;
    this.applyTarget(ap.target, ap.preparedAttemptId);
    this.preLoadSession = { attemptId: ap.preparedAttemptId, session: before }; // Gate 1f: a failed hand-over restores metadata
    fileLog("INFO", "URL_AUTO_COMMIT", { target: ap.target.kind, index: ap.target.kind === "playlist" ? ap.target.index : null, attemptId: ap.preparedAttemptId });
  }

  /** Load the next item directly (no prepared item ready). Never when nothing is left or after MAX_AUTO_FAILURES. */
  private autoLoadNext(orch: PlaybackOrchestrator, reason: string): void {
    if (this.autoFailures >= MAX_AUTO_FAILURES) {
      fileLog("WARN", "URL_AUTO_EXHAUSTED", { reason, consecutiveFailures: this.autoFailures });
      if (this.restoreVerifying) this.restoreGiveUp("exhausted"); // P0 Gate 2d: LOCAL, never silence
      return;
    }
    const t = this.nextTarget(false);
    const url = t ? this.targetUrl(t) : "";
    if (!t || !url) {
      fileLog("INFO", "URL_AUTO_END", { reason });
      if (this.restoreVerifying) this.restoreGiveUp("nothing playable left"); // P0 Gate 2d
      return;
    }
    orch.discardPrepared();
    const pid = nextMainWsAttemptId();
    this.rememberAutoAttempt(pid);
    this.autoPrep = null;
    this.autoCommit = null;
    this.applyTarget(t, pid);
    orch.playMusicCrossfade(url, 1, pid);
    fileLog("INFO", "URL_AUTO_LOAD", { reason, target: t.kind, index: t.kind === "playlist" ? t.index : null, attemptId: pid });
  }

  /**
   * P0 Drop Next: NEXT / PREV while MAIN plays its own URL session / queued item → MAIN steps it (the queue first, then
   * the playlist). One navigation at a time (ignored while a load is pending). false = not MAIN's to step (LOCAL →
   * the existing relay to the renderer, which also takes the slot back after a queued item).
   */
  private mainNav(cmd: "PREV" | "NEXT"): boolean {
    const orch = this.orchestrator;
    const sess = this.urlSession;
    if (!orch || (!sess && !this.queuedNow)) return false;
    if (this.watchedAttempt() !== orch.getState().music.attemptId) return false;
    if (orch.isMusicAttemptPending()) { console.log("[DeviceWsManager] " + cmd + " ignored — a load is already pending (one navigation)"); return true; }
    let t: AutoTarget | null = null;
    if (cmd === "NEXT") t = this.nextTarget(true);
    else if (sess) {
      const n = sess.items.length;
      let i = this.queuedNow ? sess.index : (sess.index - 1 + n) % n; // PREV from a queued item → the playlist item it interrupted
      for (let k = 0; k < n && !sess.items[i]?.url; k++) i = (i - 1 + n) % n;
      t = { kind: "playlist", index: i };
    }
    if (!t) return !!sess; // nothing to step to (URL session end, loop off) → ignore; LOCAL return → relay to the renderer
    if (this.restoreVerifying && !this.restoreDormant) { this.restoreVerifying = false; this.clearRestoreFallbackTimer(); } // P0 Gate 2d: the user navigates
    this.autoFailures = 0;
    this.autoFailed.clear();
    this.navLoad(orch, t, cmd, "user");
    return true;
  }

  /** Load navigation target `t` now (standby crossfade over the audible track — Gate 1a) and record it for rollback. */
  private navLoad(orch: PlaybackOrchestrator, t: AutoTarget | null, cmd: "PREV" | "NEXT", why: string): void {
    const sess = this.urlSession;
    const url = t ? this.targetUrl(t) : "";
    if (!t || !url) return;
    const before = this.mock.captureSession();
    orch.discardPrepared();
    const pid = nextMainWsAttemptId();
    this.rememberAutoAttempt(pid);
    this.autoPrep = null;
    this.autoEofHandledFor = 0;
    const prev = { prevAttemptId: this.watchedAttempt(), prevIndex: sess?.index ?? 0, prevQueuedNow: this.queuedNow };
    this.autoCommit = null;
    this.applyTarget(t, pid);
    orch.playMusicCrossfade(url, orch.getCrossfadeSec(), pid);
    // registered only AFTER the load call: its first push still names the OLD (audible) attempt by design and must
    // never be read as "the new load failed" (a failure is surfaced later; Gate 2a then reports the audible deck).
    this.autoCommit = { ...prev, attemptId: pid, target: t, manual: true };
    const m = orch.getState().music;
    this.preLoadSession = m.attemptMode === "crossfade" && m.attemptId === pid ? { attemptId: pid, session: before } : null;
    fileLog("INFO", "URL_NAV", { cmd, why, target: t.kind, index: t.kind === "playlist" ? t.index : null, attemptId: pid });
  }

  // ── P0 Gate 2d: restart restore ───────────────────────────────────────────────────────────────────────────

  /**
   * Production wiring only (ipc-mvp): persist the station's last source and, at boot, restore it. Tests never call it,
   * so they never touch ProgramData or the network.
   */
  enableSourcePersistence(opts: { probeUrl: string; bootRestore: boolean }): void {
    this.sourcePersist = true;
    this.probeUrl = opts.probeUrl;
    if (!opts.bootRestore) return;
    // Only the DESIGNATED station (trusted ProgramData designation cache) restores on its own at boot — a
    // non-designated desktop never starts audio by itself (its renderer restore stays CONTROL-blocked as before).
    if (!this.offlineDesignated) {
      fileLog("INFO", "RESTORE_BOOT", { source: "skipped — not the designated station" });
      return;
    }
    const saved = readPlaybackSource();
    if (!saved || saved.kind !== "url" || !saved.url) {
      this.bootSource = "local";
      fileLog("INFO", "RESTORE_BOOT", { source: saved?.kind ?? "none" });
      this.push();
      return;
    }
    this.bootSource = "deciding";
    this.push();
    const savedUrl = saved.url;
    void this.probeNetwork().then((online) => {
      if (this.bootSource !== "deciding") return; // a manual choice already decided
      if (online) {
        this.bootSource = "url";
        fileLog("INFO", "RESTORE_BOOT", { source: "url", network: "online" });
        this.beginUrlRestore(savedUrl, "boot (online)");
      } else {
        this.bootSource = "url-pending";
        this.pendingRestore = savedUrl;
        fileLog("INFO", "RESTORE_BOOT", { source: "url", network: "offline → LOCAL fallback until the network is stable" });
        this.startRestoreNetWatch();
      }
      this.push();
      this.sendStateUpdateIfMaster();
    });
  }

  /** Reachability of the station's own app server (any HTTP answer within 4 s = online). */
  private async probeNetwork(): Promise<boolean> {
    if (!this.probeUrl) return false;
    try {
      await fetch(this.probeUrl, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(4000) });
      return true;
    } catch {
      return false;
    }
  }

  /** Offline boot: probe every 30 s; TWO consecutive successes (stable, not flapping) → bring the URL source back. */
  private startRestoreNetWatch(): void {
    this.stopRestoreNetWatch();
    this.restoreNetOk = 0;
    this.restoreNetTimer = setInterval(() => {
      void this.probeNetwork().then((ok) => {
        if (!this.pendingRestore) { this.stopRestoreNetWatch(); return; }
        this.restoreNetOk = ok ? this.restoreNetOk + 1 : 0;
        if (this.restoreNetOk >= 2) this.onNetworkStable();
      });
    }, 30_000);
  }

  private stopRestoreNetWatch(): void {
    if (this.restoreNetTimer) { clearInterval(this.restoreNetTimer); this.restoreNetTimer = null; }
  }

  /** Network stable again: the saved URL source returns — never by cutting the LOCAL fallback mid-track. */
  private onNetworkStable(): void {
    const saved = this.pendingRestore;
    const orch = this.orchestrator;
    this.stopRestoreNetWatch();
    if (!saved || !orch) return;
    this.pendingRestore = null;
    const ms = orch.getState().music;
    if (ms.status === "playing" && !isMainWsAttemptId(ms.attemptId)) {
      // the LOCAL fallback is audible → arm the saved session; it takes over at the LOCAL track's mix point
      // (prepared ~60 s ahead, crossfaded — the same proven hand-off as Drop Next during LOCAL)
      this.urlSession = this.sessionFromSaved(saved);
      this.restoreDormant = true;
      this.restoreVerifying = true;
      if (this.playNext.length === 0) this.playNext = saved.playNext.slice();
      this.resetAutoAdvance();
      this.localQueueWatch = ms.attemptId;
      this.publishQueue();
      fileLog("INFO", "RESTORE_URL_ARMED", { index: saved.index, overLocalAttempt: ms.attemptId });
    } else {
      this.bootSource = "url";
      this.beginUrlRestore(saved, "network returned");
    }
    this.push();
    this.sendStateUpdateIfMaster();
  }

  private sessionFromSaved(saved: SavedUrlSession): UrlSession {
    return {
      items: saved.items.map((i) => ({ id: i.id, title: i.title, cover: i.cover, url: i.url, ...(typeof i.durationSeconds === "number" ? { durationSeconds: i.durationSeconds } : {}) })),
      index: saved.index, shell: saved.shell, sourceId: saved.sourceId, origin: saved.origin, sourceType: saved.sourceType,
      sessionTitle: saved.sessionTitle, sessionPlaylistId: saved.sessionPlaylistId, attemptId: 0,
    };
  }

  /** Make the saved URL session current again and start its item now (nothing audible / boot). */
  private beginUrlRestore(saved: SavedUrlSession, why: string): void {
    this.urlSession = this.sessionFromSaved(saved);
    this.restoreDormant = false;
    this.restoreVerifying = true;
    this.playNext = saved.playNext.slice();
    for (const q of this.playNext) { const n = Number(q.qid.replace(/^pn-/, "")); if (Number.isFinite(n) && n > this.playNextSeq) this.playNextSeq = n; }
    this.resetAutoAdvance();
    this.queuedNow = null;
    this.localQueueWatch = 0;
    this.publishQueue();
    this.publishSessionItem(this.urlSession);
    if (!this.orchestrator?.getState().music.engineReady) { this.restoreStartWhenReady = true; return; }
    this.startRestoredItem(why);
  }

  private startRestoredItem(why: string): void {
    this.restoreStartWhenReady = false;
    const orch = this.orchestrator;
    const sess = this.urlSession;
    if (!orch || !sess || this.restoreDormant) return;
    const n = sess.items.length;
    let idx = -1;
    for (let k = 0; k < n; k++) { const i = (sess.index + k) % n; if (sess.items[i]?.url) { idx = i; break; } }
    if (idx < 0) { this.restoreGiveUp("no playable item"); return; }
    const pid = nextMainWsAttemptId();
    this.rememberAutoAttempt(pid);
    this.applyTarget({ kind: "playlist", index: idx }, pid);
    orch.playMusicCrossfade(sess.items[idx].url, orch.getCrossfadeSec(), pid);
    fileLog("INFO", "RESTORE_URL_START", { why, index: idx, attemptId: pid });
  }

  /** A manual / explicit source choice replaces any pending or armed restore. */
  private cancelRestore(why: string): void {
    if (!this.pendingRestore && !this.restoreDormant && !this.restoreStartWhenReady && !this.restoreVerifying && this.bootSource !== "deciding") return;
    this.restoreVerifying = false;
    this.clearRestoreFallbackTimer();
    this.pendingRestore = null;
    this.restoreStartWhenReady = false;
    this.stopRestoreNetWatch();
    if (this.restoreDormant) { this.restoreDormant = false; this.urlSession = null; this.localQueueWatch = 0; this.resetAutoAdvance(); }
    if (this.bootSource === "deciding" || this.bootSource === "url-pending" || this.bootSource === "url-failed") this.bootSource = "local";
    fileLog("INFO", "RESTORE_CANCELLED", { why });
  }

  /**
   * P0 Gate 2d: the unproven restored URL failed with nothing (URL) audible. Budget left → the renderer plays LOCAL now
   * ("url-pending") and the saved session is ARMED over it again (prepared + taken over at the LOCAL mix point, nothing
   * cut). Budget spent → give up: LOCAL simply continues.
   */
  private restoreFailOver(orch: PlaybackOrchestrator, why: string): void {
    if (this.autoFailures >= MAX_AUTO_FAILURES || !this.urlSession) { this.restoreGiveUp(why); return; }
    this.restoreDormant = true; // nextTarget below = the dormant resume rule (skips the failed items)
    if (!this.nextTarget(false)) { this.restoreGiveUp(why); return; }
    orch.discardPrepared();
    this.autoPrep = null;
    this.autoCommit = null;
    this.preLoadSession = null;
    this.queuedNow = null;
    this.restoreTakeoverAttemptId = 0;
    this.bootSource = "url-pending";
    const ms = orch.getState().music;
    // a LOCAL attempt still audible (a failed take-over) is watched at once; otherwise the renderer's LOCAL start is
    this.localQueueWatch = ms.status === "playing" && !isMainWsAttemptId(ms.attemptId) ? ms.attemptId : 0;
    this.autoEofHandledFor = 0;
    this.sessionPlayedFor = 0;
    fileLog("WARN", "RESTORE_URL_FAILOVER", { why, consecutiveFailures: this.autoFailures, localAudible: this.localQueueWatch > 0 });
    // no LOCAL music starts (none on this station) → retry the URL directly rather than stay silent
    this.clearRestoreFallbackTimer();
    this.restoreFallbackTimer = setTimeout(() => {
      this.restoreFallbackTimer = null;
      const o = this.orchestrator;
      if (!o || !this.restoreDormant || this.localQueueWatch > 0 || o.getState().music.status === "playing" || o.isMusicAttemptPending()) return;
      this.restoreDormant = false;
      this.bootSource = "url";
      fileLog("INFO", "RESTORE_URL_RETRY", { why: "no LOCAL music started" });
      this.autoLoadNext(o, "restore retry (no LOCAL)");
      this.push();
      this.sendStateUpdateIfMaster();
    }, 25_000);
    this.publishQueue();
    this.push();
    this.sendStateUpdateIfMaster();
  }

  /** P0 Gate 2d: the remembered URL cannot be restored now → LOCAL plays on (the saved source stays for the next boot). */
  private restoreGiveUp(why: string): void {
    this.restoreVerifying = false;
    this.clearRestoreFallbackTimer();
    this.orchestrator?.discardPrepared();
    this.urlSession = null;
    this.restoreDormant = false;
    this.restoreTakeoverAttemptId = 0;
    this.localQueueWatch = 0;
    this.queuedNow = null;
    this.playNext = [];
    this.preLoadSession = null;
    this.resetAutoAdvance();
    this.bootSource = "url-failed";
    this.publishQueue();
    fileLog("WARN", "RESTORE_URL_GAVE_UP", { why });
    this.push();
    this.sendStateUpdateIfMaster();
  }

  private clearRestoreFallbackTimer(): void {
    if (this.restoreFallbackTimer) { clearTimeout(this.restoreFallbackTimer); this.restoreFallbackTimer = null; }
  }

  /** Persist the station's source = this URL playlist (+ queue). Never while a saved session is only armed. */
  private persistUrl(): void {
    const sess = this.urlSession;
    if (!this.sourcePersist || !sess || this.restoreDormant) return;
    writePlaybackSource({
      kind: "url",
      url: {
        items: sess.items.map((i) => ({ id: i.id, title: i.title, cover: i.cover, url: i.url, ...(typeof i.durationSeconds === "number" ? { durationSeconds: i.durationSeconds } : {}) })),
        index: sess.index, shell: sess.shell, sourceId: sess.sourceId, origin: sess.origin, sourceType: sess.sourceType,
        sessionTitle: sess.sessionTitle, sessionPlaylistId: sess.sessionPlaylistId,
        playNext: this.playNext.map((q) => ({ qid: q.qid, id: q.id, title: q.title, cover: q.cover, url: q.url })),
      },
    });
  }

  private persistLocal(): void {
    if (!this.sourcePersist) return;
    writePlaybackSource({ kind: "local" });
  }

  /** P0 Gate 2c: MAIN owns the automatic progression of the URL / queued attempt now playing (the renderer must not
   *  step it). A LOCAL attempt that merely yields its next slot is still the renderer's (false). */
  private mainOwnsAutoAdvance(): boolean {
    const w = this.watchedAttempt();
    if (!(w > 0) || !this.orchestrator || (!this.urlSession && !this.queuedNow) || (this.restoreDormant && !this.queuedNow)) return false;
    const o = this.orchestrator as { getState?: () => { music: { attemptId: number } } };
    return typeof o.getState === "function" && o.getState().music.attemptId === w;
  }

  private currentAttemptIs(id: number): boolean {
    const o = this.orchestrator as { getState?: () => { music: { attemptId: number } } } | null;
    return !!o && typeof o.getState === "function" && id > 0 && o.getState().music.attemptId === id;
  }

  /** P0 Gate 1f: read-only readiness for status reporting — never throws (status must always be reportable). */
  private attemptPending(): boolean {
    const o = this.orchestrator as { isMusicAttemptPending?: () => boolean } | null;
    return !!o && typeof o.isMusicAttemptPending === "function" ? o.isMusicAttemptPending() : false;
  }

  private restorePreLoadSession(reason: string): void {
    const pre = this.preLoadSession;
    if (!pre) return;
    this.preLoadSession = null;
    this.mock.restoreSession(pre.session);
    console.log("[VONO session-restore] restored the audible session metadata — " + reason, { attemptId: pre.attemptId });
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
        // P0 Gate 1a: EVERY WS URL load goes through playMusicCrossfade() — the orchestrator decides crossfade vs cold
        // from the REAL active deck (cold only when nothing is audible). Never infer audibility from the
        // current-attempt snapshot (a pending / failed attempt reads idle while the active deck is still audible).
        if (url) {
          this.urlSession = null; // P0 Gate 2c: a raw URL PLAY is not a session MAIN advances
          this.resetAutoAdvance();
          orch.playMusicCrossfade(url, fadeSec, nextMainWsAttemptId());
        } else {
          const mpvStatus = orch.getState().music.status;
          if (mpvStatus === "paused") {
            orch.resumeMusic();
          } else if (orch.isMusicAttemptPending()) {
            // P0 Gate 1a: a PLAY while the current attempt is still loading must NOT restart that load.
            console.log("[DeviceWsManager] PLAY ignored — current music attempt still pending");
          } else {
            const srcUrl = (this.mock.getState().currentSource?.url ?? "").trim();
            if (srcUrl) {
              console.log("[DeviceWsManager] PLAY → loadfile on Channel A:", srcUrl.slice(0, 100));
              orch.playMusicCrossfade(srcUrl, fadeSec, nextMainWsAttemptId());
              if (this.urlSession) { this.urlSession.attemptId = orch.getState().music.attemptId; this.resetAutoAdvance(); } // P0 Gate 2c
            } else {
              orch.resumeMusic();
            }
          }
        }
        break;
      }
      case "PLAY_SOURCE": {
        // P0 Gate 1a: an identical PLAY_SOURCE (same source id + trackIndex) for the target whose load is STILL pending
        // is a duplicate intent → ignore it (no metadata churn, no abort / relaunch of the in-flight load).
        {
          const dupSrc = (payload as { source?: { id?: unknown; url?: unknown }; trackIndex?: unknown } | null | undefined);
          const dupKey = typeof dupSrc?.source?.id === "string" && typeof dupSrc?.source?.url === "string" && dupSrc.source.url.trim()
            ? `${dupSrc.source.id}#${typeof dupSrc.trackIndex === "number" ? dupSrc.trackIndex : 0}`
            : null;
          if (dupKey && dupKey === this.pendingWsLoadKey && orch.isMusicAttemptPending()) {
            console.log("[DeviceWsManager] PLAY_SOURCE ignored — same target already loading");
            break;
          }
        }
        // P0 Gate 1e — LOCKED: a NON-LOCAL PLAY_SOURCE without a playable URL changes NOTHING (rejected BEFORE any
        // session / display metadata, no attempt, audible playback untouched). LOCAL (type "local", paths stripped on
        // the wire) keeps the metadata-only sync below.
        {
          const rs = (payload as { source?: { type?: unknown; url?: unknown } } | null | undefined)?.source;
          const rUrl = typeof rs?.url === "string" ? rs.url.trim() : "";
          if (rs && rs.type !== "local" && !rUrl) {
            console.warn("[DeviceWsManager] PLAY_SOURCE rejected — non-LOCAL source without a playable URL (metadata unchanged)");
            this.lastCommandSummary = "PLAY_SOURCE rejected (no playable URL)";
            break;
          }
        }
        // P0 Gate 1f: the session that is published BEFORE this selection (restored if its standby load fails).
        const preLoadPrev = this.mock.captureSession();
        const preLoadWasPending = this.preLoadSession !== null && orch.isMusicAttemptPending();
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
        if (!url) this.preLoadSession = null; // P0 Gate 1f: a LOCAL (metadata-only) session supersedes any pending URL standby
        // P0 Gate 2d: a LOCAL session the USER chose (renderer intent "user") replaces the station's source and cancels a
        // pending URL restore; the LOCAL FALLBACK of an offline boot (no intent) keeps the saved URL source armed.
        const userIntent = (payload as { intent?: unknown } | null | undefined)?.intent === "user";
        const keepRestore = !url && !userIntent && (this.restoreDormant || this.pendingRestore !== null);
        if (!url && !keepRestore) {
          if (this.urlSession) { this.urlSession = null; this.resetAutoAdvance(); } // P0 Gate 2c: LOCAL is never MAIN-advanced
          this.cancelRestore(userIntent ? "LOCAL chosen" : "LOCAL session");
          if (this.bootSource === "url") this.bootSource = "local"; // a renderer reload now restores LOCAL again
          this.persistLocal();
        }
        if (!url) { this.queuedNow = null; this.localQueueWatch = 0; } // P0 Drop Next: the renderer's LOCAL session is current again
        if (!url) break; // local (paths stripped on the wire) → audio handled by the co-located renderer engine
        const fadeSec = orch.getCrossfadeSec();
        // P0 Gate 1a: always the crossfade entry point (orchestrator → cold only when nothing is audible).
        this.pendingWsLoadKey = typeof src?.id === "string" ? `${src.id}#${typeof srcMeta?.trackIndex === "number" ? srcMeta.trackIndex : 0}` : null;
        orch.playMusicCrossfade(url, fadeSec, nextMainWsAttemptId());
        // P0 Gate 1f: remember the audible session only for a STANDBY load (something audible keeps playing). A newer
        // selection while still pending keeps the ORIGINAL audible session (never an intermediate unproven one).
        {
          const m = orch.getState().music;
          this.preLoadSession = m.attemptMode === "crossfade" && typeof m.attemptId === "number" && m.attemptId > 0
            ? { attemptId: m.attemptId, session: preLoadWasPending && this.preLoadSession ? this.preLoadSession.session : preLoadPrev }
            : null;
        }
        // P0 Gate 2c: MAIN takes over the AUTOMATIC progression of this URL session (rebuilt from every selection).
        this.cancelRestore("URL selected"); // P0 Gate 2d: an explicit selection replaces any pending restore
        this.urlSession = buildUrlSession(payload);
        if (this.urlSession) this.urlSession.attemptId = orch.getState().music.attemptId;
        this.resetAutoAdvance();
        this.queuedNow = null; // P0 Drop Next: an explicit selection plays now; the queue itself is kept
        this.localQueueWatch = 0;
        this.persistUrl(); // P0 Gate 2d: the station's source is now this URL playlist
        break;
      }
      case "QUEUE_NEXT": {
        // P0 Drop Next: add the dropped URL / playlist (all its tracks, in order) to MAIN's Play Next queue.
        const items = buildQueueItems(payload);
        if (items.length === 0) { console.log("[DeviceWsManager] QUEUE_NEXT ignored — nothing playable (URLs only)"); break; }
        for (const it of items) {
          if (this.playNext.length >= MAX_PLAY_NEXT) break;
          this.playNextSeq += 1;
          this.playNext.push({ ...it, qid: `pn-${this.playNextSeq}` });
        }
        this.publishQueue();
        this.persistUrl(); // P0 Gate 2d
        fileLog("INFO", "QUEUE_NEXT_ADDED", { added: items.length, queued: this.playNext.length });
        // nothing audible and nothing loading → the queue plays now
        const ms = orch.getState().music;
        if (ms.status !== "playing" && ms.status !== "paused" && !orch.isMusicAttemptPending() && !this.inAutoTick) {
          this.inAutoTick = true;
          try { this.autoFailures = 0; this.autoLoadNext(orch, "queue while idle"); } finally { this.inAutoTick = false; }
        }
        break;
      }
      case "QUEUE_REMOVE": {
        const qid = typeof (payload as { queueItemId?: unknown } | null | undefined)?.queueItemId === "string" ? (payload as { queueItemId: string }).queueItemId : "";
        if (!qid) break;
        this.playNext = this.playNext.filter((q) => q.qid !== qid);
        if (this.autoPrep?.target.kind === "queue" && this.autoPrep.target.item.qid === qid) { orch.discardPrepared(); this.autoPrep = null; }
        this.publishQueue();
        this.persistUrl(); // P0 Gate 2d
        break;
      }
      case "PAUSE": {
        // P0 Gate 1f: PAUSE during a pending standby abandons it — the paused (old) track is what the session shows.
        const abandon = this.preLoadSession !== null && orch.isMusicAttemptPending();
        orch.pauseMusic();
        if (abandon) this.restorePreLoadSession("pause during pending standby");
        break;
      }
      case "STOP":
        if (this.preLoadSession !== null && orch.isMusicAttemptPending()) this.restorePreLoadSession("stop during pending standby"); // P0 Gate 1f
        this.resetAutoAdvance(); // P0 Gate 2c (stopMusic drops any prepared track)
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
            this.handleRemoteStep(cmd);
          } else if (cmd === "JUMP_SESSION_INDEX") {
            this.handleRemoteJump(p.payload); // P0 Gate 1e
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
