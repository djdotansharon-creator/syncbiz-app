/**
 * Desktop Playback Orchestrator — the single gatekeeper above all MPV instances.
 *
 * Architecture rules (enforced here):
 *  - Nothing outside this class calls MpvManager directly.
 *  - Channel A (music)     = continuous background playback — TWO decks (A/B)
 *    so track/source changes are a TRUE overlap crossfade (like the browser's
 *    YouTube deck engine), not fade-to-silence → replace → fade-in.
 *  - Channel B (interrupt) = jingles / announcements / TTS, queued FIFO.
 *  - Ducking ramps the ACTIVE music deck volume down when an interrupt starts,
 *    and back up when it ends.
 *
 * Crossfade contract (business player — audio must never die):
 *  - The incoming track loads on the STANDBY deck at volume 0; the ramp starts
 *    only when that deck reports "playing" (never on a blind timer).
 *  - If the incoming track fails to start within XFADE_LOAD_TIMEOUT_MS, the
 *    crossfade is aborted and the CURRENT track keeps playing at full volume.
 *  - UI volume (getState().music.volume) reports masterVolume during ramps so
 *    the operator's fader never "drops by itself" mid-mix (duck stays visible).
 */

import { MpvManager, type MpvBinaries, type MpvStatus, createInitialMpvStatus } from "./mpv-manager";
import { redactMediaToken } from "../shared/redact-media-token";
import { normalizeMpvLoadTarget } from "./mpv-input-normalize";
import { mediaKey as liveMediaKey } from "./live-media-key";

const ORCH = "[SyncBiz:desktop-mpv:orchestrator] music";

// ─── Ducking constants ────────────────────────────────────────────────────────
/** Default duck depth: music falls to this % of masterVolume while Channel B plays.
 *  Exposed as a runtime-configurable field so the test panel can tune it live. */
const DUCK_PERCENT_DEFAULT = 40;
/** Number of volume steps in each duck ramp (up or down). */
const DUCK_STEPS = 8;
/** Milliseconds between each duck ramp step. */
const DUCK_STEP_MS = 30;

// ─── Crossfade constants ──────────────────────────────────────────────────────
/** Volume steps per second during an A/B crossfade ramp. */
const XFADE_STEPS_PER_SEC = 10;
/** Standby deck must reach "playing" within this window or the crossfade aborts (active track keeps
 *  playing). SOURCE-AWARE: local files load instantly (12s is plenty; real local failures surface via
 *  decode-fail sooner), but a URL resolves through yt-dlp and can take ~20–30s on real hardware — so a
 *  stream gets the full 30s window (== renderer STREAM_STARTUP_TIMEOUT_MS). */
const XFADE_LOAD_TIMEOUT_LOCAL_MS = 12_000;
const XFADE_LOAD_TIMEOUT_URL_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrchestratorState = {
  /** Music playback status (the ACTIVE deck; volume field is display-stable) + the authoritative
   *  current-attempt mode ("cold" | "crossfade") so the renderer never has to infer it. */
  music: MpvStatus & { attemptMode: "cold" | "crossfade" };
  /** Channel B — interrupt channel status. */
  interrupt: MpvStatus;
  isDucked: boolean;
  masterVolume: number;
  /** Volume music is ramped to when ducked (= masterVolume * duckPercent / 100). */
  duckTargetVolume: number;
  /** Configurable duck depth 0–100 (% of masterVolume music is held at during interrupt). */
  duckPercent: number;
  /** true if Channel B has a file loaded or queued. */
  interruptBusy: boolean;
  /** How many clips are waiting behind the current interrupt. */
  interruptQueueDepth: number;
  /** Hash of the current music attempt's URL (never the raw URL). Lets a renderer remount prove it is
   *  re-owning the SAME live media before adopting the engine. Empty when nothing is playing. */
  currentMediaKey: string;
};

type StatusListener = (state: OrchestratorState) => void;

type InterruptItem = { url: string };

type MusicDeckId = "A" | "B";

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class PlaybackOrchestrator {
  private readonly musicDeckA: MpvManager;
  private readonly musicDeckB: MpvManager;
  private readonly interruptMpv: MpvManager;

  private musicStA: MpvStatus = createInitialMpvStatus();
  private musicStB: MpvStatus = createInitialMpvStatus();
  private interruptSt: MpvStatus = createInitialMpvStatus();
  /** Which music deck currently owns the audible track. */
  private activeMusicDeck: MusicDeckId = "A";
  /** Deck holding the CURRENT playback attempt: the standby (incoming) deck while a crossfade is
   *  pending/ramping, otherwise the active deck. getState() reports THIS deck so the renderer/CONTROL
   *  always see the CURRENT attempt's truth — never the outgoing track's status during a crossfade,
   *  which would let A masquerade as confirmation of B. */
  private currentAttemptDeck: MusicDeckId = "A";
  /** Renderer-allocated id of the current attempt, echoed back on status so the renderer can ignore
   *  stale/anonymous MPV events belonging to a superseded attempt. */
  private currentAttemptId = 0;
  /** AUTHORITATIVE mode of the current attempt. "crossfade" = incoming loaded on the STANDBY deck
   *  (orchestrator owns the startup timeout; active good track keeps playing). "cold" = loaded on the
   *  ACTIVE deck (renderer owns the PR-24 startup timeout). Stays attached to this attempt until the
   *  next attempt begins — so a post-abort timeout race can't flip it. */
  private currentAttemptMode: "cold" | "crossfade" = "cold";
  /** Non-null when the CURRENT attempt failed to load/decode (crossfade decode-fail or start timeout).
   *  Surfaced as the reported music `lastError` (with status "idle") so the renderer treats the attempt
   *  as failed and advances the queue — while the outgoing track keeps playing (never-stop). Cleared on
   *  the next play. */
  private currentAttemptError: string | null = null;
  /** URL of the current attempt — exposed to the renderer ONLY as a hash (`currentMediaKey`) so a renderer
   *  remount can prove it is re-owning the SAME live media before adopting it. Never exposed as a raw URL. */
  private currentAttemptUrl = "";

  private masterVolume = 80;
  private duckPercent = DUCK_PERCENT_DEFAULT;
  private isDucked = false;
  private preDuckVolume = 80;
  private killed = false;
  private interruptBusy = false;
  /**
   * True only after Channel B has fired start-file (status reached "playing").
   * Guards against MPV's spurious `end-file reason=replace` that fires before
   * the clip starts playing when `loadfile` replaces the idle/previous state.
   */
  private interruptHasStarted = false;
  private readonly interruptQueue: InterruptItem[] = [];

  /** Mix/crossfade duration (seconds) — synced from renderer Settings; 6s fallback. */
  private crossfadeSec = 6;

  /** Handle to the active duck-ramp timer. Cancelled before any new ramp starts. */
  private rampId: ReturnType<typeof setInterval> | null = null;

  // ── Crossfade in-flight state ──────────────────────────────────────────────
  /** Set while the standby deck is loading the incoming track (pre-ramp). */
  private xfadePending: { fadeSec: number } | null = null;
  /** MPV optimistically reports "playing" on start-file even for a file that
   *  fails to decode. Track whether the pending standby ever claimed playing so
   *  a subsequent idle/stopped can be recognized as a load FAILURE. */
  private xfadeStandbySawPlaying = false;
  /** Abort timer for a standby deck that never starts playing. */
  private xfadeStartTimeoutId: ReturnType<typeof setTimeout> | null = null;
  /** Handle to the active crossfade dual-ramp timer. */
  private xfadeRampId: ReturnType<typeof setInterval> | null = null;

  private listener: StatusListener | null = null;

  constructor() {
    this.musicDeckA = new MpvManager("syncbiz-music");
    this.musicDeckB = new MpvManager("syncbiz-music-b");
    this.interruptMpv = new MpvManager("syncbiz-interrupt");

    this.musicDeckA.onStatus((s) => {
      this.musicStA = s;
      this.onMusicDeckStatus("A", s);
      this.push();
    });
    this.musicDeckB.onStatus((s) => {
      this.musicStB = s;
      this.onMusicDeckStatus("B", s);
      this.push();
    });

    this.interruptMpv.onStatus((s) => {
      this.interruptSt = s;

      if (this.interruptBusy) {
        // Step 1: wait for the clip to actually start playing.
        // MPV fires `end-file reason=replace` BEFORE `start-file` when loadfile
        // replaces the current (idle) state. We must not treat that as clip-end.
        if (s.status === "playing") {
          this.interruptHasStarted = true;
        }

        // Step 2: only detect end AFTER the clip confirmed it started.
        if (this.interruptHasStarted && (s.status === "idle" || s.status === "stopped")) {
          this.interruptHasStarted = false;
          this.onInterruptEnd();
        }
      }

      this.push();
    });
  }

  // ─── Deck helpers ────────────────────────────────────────────────────────────

  private musicDeck(id: MusicDeckId): MpvManager {
    return id === "A" ? this.musicDeckA : this.musicDeckB;
  }

  private activeMpv(): MpvManager {
    return this.musicDeck(this.activeMusicDeck);
  }

  private standbyDeckId(): MusicDeckId {
    return this.activeMusicDeck === "A" ? "B" : "A";
  }

  private standbyMpv(): MpvManager {
    return this.musicDeck(this.standbyDeckId());
  }

  /** Reset the CURRENT-attempt deck's cached status to a fresh baseline. Called at the start of a new
   *  attempt so the immediate authoritative push() can't report a stale OUTGOING "playing"+position
   *  under the NEW attempt id (which the renderer would otherwise false-confirm / spuriously advance on).
   *  The deck's real start-file repopulates it moments later. */
  private resetCurrentAttemptDeckStatus(): void {
    if (this.currentAttemptDeck === "A") this.musicStA = createInitialMpvStatus();
    else this.musicStB = createInitialMpvStatus();
  }

  private activeSt(): MpvStatus {
    return this.activeMusicDeck === "A" ? this.musicStA : this.musicStB;
  }

  /** Status of the deck holding the CURRENT attempt (what getState reports). */
  private currentAttemptSt(): MpvStatus {
    return this.currentAttemptDeck === "A" ? this.musicStA : this.musicStB;
  }

  /** The volume music should sit at right now (duck-aware). */
  private currentMusicTarget(): number {
    return this.isDucked
      ? Math.max(0, Math.round((this.masterVolume * this.duckPercent) / 100))
      : this.masterVolume;
  }

  /** Standby deck status while a crossfade is pending: start the ramp only on
   *  REAL decode (playing + position/duration evidence — MPV claims "playing"
   *  on start-file even for files that fail to load); abort fast when the
   *  standby falls back to idle/stopped after such a false start. */
  private onMusicDeckStatus(deck: MusicDeckId, s: MpvStatus): void {
    if (!this.xfadePending || deck !== this.standbyDeckId()) return;
    // CORRELATION: a late/superseded standby event (from a previous load) must be POWERLESS — it must
    // never mark the crossfade as playing, start the ramp, or trip decode-fail, which could fade away
    // the good active track before the NEW URL truly started. MpvManager keeps the OLD attemptId until
    // the new load's start-file binds, so this filters exactly those stale events.
    if (s.attemptId !== this.currentAttemptId) return;
    if (s.status === "playing") {
      this.xfadeStandbySawPlaying = true;
      if (s.duration > 0 || s.position > 0) {
        const { fadeSec } = this.xfadePending;
        this.xfadePending = null;
        if (this.xfadeStartTimeoutId !== null) {
          clearTimeout(this.xfadeStartTimeoutId);
          this.xfadeStartTimeoutId = null;
        }
        this.beginXfadeRamp(fadeSec);
      }
      return;
    }
    if (this.xfadeStandbySawPlaying && (s.status === "idle" || s.status === "stopped")) {
      // start-file fired but decode failed (bad path / unresolvable URL).
      console.warn(ORCH, "crossfade standby failed to decode — keeping current track");
      this.abortXfade("standby_decode_failed");
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Start all MPV channels. Binary paths must have been resolved by the
   * runtime-binaries module (see `ensureRuntimeBinaries` in `index.ts`)
   * and passed through to here.
   */
  start(binaries: MpvBinaries): void {
    this.musicDeckA.start(binaries);
    this.musicDeckB.start(binaries);
    this.interruptMpv.start(binaries);
  }

  kill(): void {
    this.killed = true;
    if (this.rampId !== null) {
      clearInterval(this.rampId);
      this.rampId = null;
    }
    this.clearXfadeTimers();
    this.musicDeckA.kill();
    this.musicDeckB.kill();
    this.interruptMpv.kill();
  }

  // ─── Status ──────────────────────────────────────────────────────────────────

  onStatus(fn: StatusListener): void {
    this.listener = fn;
  }

  getState(): OrchestratorState {
    // Report the CURRENT-ATTEMPT deck (incoming during a crossfade), NOT the outgoing active deck,
    // so the renderer/CONTROL see the current attempt's real status + attemptId. A failed incoming
    // attempt is surfaced via `currentAttemptError` (status forced to "idle" + the error), which the
    // renderer treats as a load failure and skips — while the outgoing track keeps playing.
    const cur = this.currentAttemptSt();
    const displayVolume = this.isDucked ? cur.volume : this.masterVolume;
    // CORRELATION: the deck keeps the OLD attemptId until the new load's start-file binds. Never relabel
    // a stale OLD deck status as the NEW attempt.
    //  1) currentAttemptError → surface it under currentAttemptId (status idle + error) so a timeout/
    //     decode failure still triggers the renderer's one-time SKIP_FORWARD.
    //  2) else if the deck hasn't bound the current attempt yet (cur.attemptId !== currentAttemptId) →
    //     publish a NON-CONFIRMING pending snapshot (idle / pos 0 / dur 0 / no error) under the
    //     authoritative id+mode, so a stale playing/pos/dur can't false-confirm the new attempt.
    //  3) else (bound) → publish the real deck status.
    const music: MpvStatus & { attemptMode: "cold" | "crossfade" } =
      this.currentAttemptError
        ? { ...cur, status: "idle", lastError: this.currentAttemptError, attemptId: this.currentAttemptId, attemptMode: this.currentAttemptMode, volume: displayVolume }
        : cur.attemptId !== this.currentAttemptId
          ? { ...cur, status: "idle", position: 0, duration: 0, lastError: null, attemptId: this.currentAttemptId, attemptMode: this.currentAttemptMode, volume: displayVolume }
          : { ...cur, attemptId: this.currentAttemptId, attemptMode: this.currentAttemptMode, volume: displayVolume };
    return {
      music,
      interrupt: { ...this.interruptSt },
      isDucked: this.isDucked,
      masterVolume: this.masterVolume,
      duckTargetVolume: Math.max(0, Math.round((this.masterVolume * this.duckPercent) / 100)),
      duckPercent: this.duckPercent,
      interruptBusy: this.interruptBusy,
      interruptQueueDepth: this.interruptQueue.length,
      currentMediaKey: liveMediaKey(this.currentAttemptUrl),
    };
  }

  private push(): void {
    this.listener?.(this.getState());
  }

  // ─── Channel A — music ───────────────────────────────────────────────────────

  /** Sync mix duration from renderer Settings (3/6/9/12). */
  setCrossfadeSec(seconds: number): void {
    const n = Math.round(seconds);
    if (n >= 3 && n <= 30) this.crossfadeSec = n;
  }

  getCrossfadeSec(): number {
    return this.crossfadeSec;
  }

  playMusic(url: string, attemptId = 0): void {
    const u = url.trim();
    if (!u) return;
    console.log(ORCH, "playMusic (→ active deck loadfile/replace)", { preview: redactMediaToken(u).slice(0, 200), deck: this.activeMusicDeck, attemptId });
    this.abortXfade("cold_play_request");
    // Cold play: the current attempt lives on the ACTIVE deck. Clear any prior failure.
    // setVolume() mutates + pushes the MpvManager's INTERNAL status, so do it FIRST — while the OLD
    // attempt still owns the id — so that push carries the old id (never the OLD deck state under the
    // NEW id). Only then install the new attempt, reset the cached deck status, and push the
    // authoritative id/mode. After that first NEW-id snapshot, no push before real start-file can report
    // playing/pos>0/dur>0 from old deck state.
    this.activeMpv().setVolume(this.currentMusicTarget());
    this.currentAttemptId = attemptId;
    this.currentAttemptUrl = u;
    this.currentAttemptDeck = this.activeMusicDeck;
    this.currentAttemptMode = "cold"; // authoritative: renderer owns the PR-24 startup timeout for cold
    this.currentAttemptError = null;
    this.resetCurrentAttemptDeckStatus();
    this.push(); // deliver authoritative attemptId+mode to the renderer BEFORE any MPV start-file event
    this.activeMpv().play(u, attemptId);
  }

  /**
   * TRUE A/B crossfade: the incoming track loads on the standby deck at volume 0
   * and only when it actually starts playing do both decks ramp (out/in) over
   * `fadeSec`, then the decks swap and the old one stops. If the incoming track
   * never starts, the current track keeps playing untouched.
   */
  playMusicCrossfade(url: string, fadeSec: number, attemptId = 0): void {
    const u = url.trim();
    if (!u) return;

    const activeStatus = this.activeSt().status;
    if (activeStatus !== "playing" && activeStatus !== "paused") {
      // Nothing audible to fade from — clean start, no dip. playMusic() sets currentAttemptMode="cold",
      // so the snapshot correctly reports "cold" and the renderer retains PR-24 startup ownership.
      console.log(ORCH, "playMusicCrossfade → cold start (active deck idle)", { preview: redactMediaToken(u).slice(0, 120), attemptId });
      this.playMusic(u, attemptId);
      return;
    }

    // A crossfade already mid-flight? Settle it instantly (swap if the incoming
    // deck is audible, drop it otherwise) so the new request starts clean.
    this.settleXfadeNow("new_crossfade_request");

    const standby = this.standbyMpv();
    console.log(ORCH, "playMusicCrossfade → A/B overlap", {
      preview: redactMediaToken(u).slice(0, 200),
      fadeSec,
      activeDeck: this.activeMusicDeck,
      standbyDeck: this.standbyDeckId(),
      attemptId,
    });
    // Incoming attempt lives on the STANDBY deck until the ramp swaps it in — report IT as the
    // current attempt so a failure there is seen as this attempt's failure (not the outgoing track's).
    // Standby volume 0 FIRST — while the OLD attempt still owns the id — because setVolume() mutates +
    // pushes the standby MpvManager's INTERNAL status; keeping it before the install keeps that push on
    // the old id (never OLD deck state under the NEW id).
    standby.setVolume(0);
    this.currentAttemptId = attemptId;
    this.currentAttemptUrl = u;
    this.currentAttemptDeck = this.standbyDeckId();
    this.currentAttemptMode = "crossfade"; // authoritative: orchestrator owns the startup timeout here
    this.currentAttemptError = null;
    this.resetCurrentAttemptDeckStatus();
    this.push(); // deliver authoritative attemptId+mode to the renderer NOW, before the (yt-dlp-delayed)
                 // start-file — so the renderer defers its cold startup-timeout from t≈0, not at ~30s.
    this.xfadePending = { fadeSec };
    this.xfadeStandbySawPlaying = false;
    standby.play(u, attemptId);
    // SOURCE-AWARE window: URLs (yt-dlp) get 30s; local files keep the fast 12s. Reuse the existing
    // normalizer's classification — no duplicate URL/local logic.
    const loadTimeoutMs = normalizeMpvLoadTarget(u).kind === "url" ? XFADE_LOAD_TIMEOUT_URL_MS : XFADE_LOAD_TIMEOUT_LOCAL_MS;
    this.xfadeStartTimeoutId = setTimeout(() => {
      // Incoming track never started (bad URL / yt-dlp failure): keep the business audio alive on the
      // current track — never fade into silence. Aborts the STANDBY deck only; active deck untouched.
      console.warn(ORCH, "crossfade standby load timeout — keeping current track", { preview: redactMediaToken(u).slice(0, 120), loadTimeoutMs });
      this.abortXfade("standby_load_timeout");
    }, loadTimeoutMs);
  }

  /** Dual ramp: active target→0, standby 0→target, then swap decks. */
  private beginXfadeRamp(fadeSec: number): void {
    if (this.xfadeRampId !== null) {
      clearInterval(this.xfadeRampId);
      this.xfadeRampId = null;
    }
    const sec = Math.max(1, fadeSec);
    const steps = Math.max(4, Math.round(sec * XFADE_STEPS_PER_SEC));
    const stepMs = Math.max(20, Math.round((sec * 1000) / steps));
    const target = this.currentMusicTarget();
    const outDeck = this.activeMpv();
    const inDeck = this.standbyMpv();
    console.log(ORCH, "crossfade ramp start", { fadeSec: sec, steps, stepMs, target, toDeck: this.standbyDeckId() });
    let step = 0;
    this.xfadeRampId = setInterval(() => {
      step++;
      const frac = Math.min(1, step / steps);
      outDeck.setVolume(Math.round(target * (1 - frac)));
      inDeck.setVolume(Math.round(target * frac));
      if (step >= steps) {
        clearInterval(this.xfadeRampId!);
        this.xfadeRampId = null;
        this.finishXfadeSwap();
      }
    }, stepMs);
  }

  /** Ramp complete: standby is the audible deck now — swap roles, stop the old deck. */
  private finishXfadeSwap(): void {
    const oldDeck = this.activeMpv();
    this.activeMusicDeck = this.standbyDeckId();
    // The incoming attempt is now the audible active deck — keep the current-attempt pointer on it.
    this.currentAttemptDeck = this.activeMusicDeck;
    oldDeck.stop();
    console.log(ORCH, "crossfade complete — decks swapped", { activeDeck: this.activeMusicDeck });
    this.push();
  }

  /** A crossfade is mid-flight and a new command arrived: settle it instantly. */
  private settleXfadeNow(reason: string): void {
    if (this.xfadeRampId !== null) {
      // Ramp already running → the incoming deck is audible; complete the swap now.
      clearInterval(this.xfadeRampId);
      this.xfadeRampId = null;
      this.standbyMpv().setVolume(this.currentMusicTarget());
      console.log(ORCH, "crossfade settled early (instant swap)", { reason });
      this.finishXfadeSwap();
      return;
    }
    this.abortXfade(reason);
  }

  /** Cancel a pending/not-yet-audible crossfade; current track keeps playing. */
  private abortXfade(reason: string): void {
    const hadPending = this.xfadePending !== null || this.xfadeRampId !== null;
    this.clearXfadeTimers();
    if (!hadPending) return;
    this.standbyMpv().stop();
    // Restore the active deck to its proper level in case the ramp had begun.
    this.activeMpv().setVolume(this.currentMusicTarget());
    // Incoming-attempt FAILURE (decode-fail / never-started timeout): mark the CURRENT attempt failed so
    // the renderer advances the queue. The outgoing (active) track keeps playing — audio never drops.
    // Benign aborts (cold_play_request / pause_command / new_crossfade_request) do NOT flag a failure.
    if (reason === "standby_decode_failed" || reason === "standby_load_timeout") {
      this.currentAttemptError =
        reason === "standby_load_timeout"
          ? "incoming track failed to start (load timeout)"
          : "incoming track failed to decode";
    }
    console.log(ORCH, "crossfade aborted", { reason });
    this.push();
  }

  private clearXfadeTimers(): void {
    this.xfadePending = null;
    this.xfadeStandbySawPlaying = false;
    if (this.xfadeStartTimeoutId !== null) {
      clearTimeout(this.xfadeStartTimeoutId);
      this.xfadeStartTimeoutId = null;
    }
    if (this.xfadeRampId !== null) {
      clearInterval(this.xfadeRampId);
      this.xfadeRampId = null;
    }
  }

  pauseMusic(): void {
    console.log(ORCH, "pauseMusic (→ active deck pause)");
    this.abortXfade("pause_command");
    this.activeMpv().pause();
  }

  resumeMusic(): void {
    console.log(ORCH, "resumeMusic (→ active deck resume)");
    this.activeMpv().resume();
  }

  stopMusic(): void {
    console.log(ORCH, "stopMusic (→ both music decks stop)");
    this.clearXfadeTimers();
    this.musicDeckA.stop();
    this.musicDeckB.stop();
  }

  /** Seek the audible music deck to an absolute position in seconds. */
  seekMusic(seconds: number): void {
    console.log(ORCH, "seekMusic", { seconds });
    this.activeMpv().seek(seconds);
  }

  /** Set duck depth 0–100 (percent of masterVolume music falls to during interrupt). */
  setDuckPercent(n: number): void {
    this.duckPercent = Math.max(0, Math.min(100, Math.round(n)));
    this.push();
  }

  /** Set master volume (0–100). Applies to the audible deck immediately unless ducked. */
  setVolume(n: number): void {
    const v = Math.max(0, Math.min(100, Math.round(n)));
    console.log(ORCH, "setVolume (→ active deck unless ducked)", { volume: v });
    this.masterVolume = v;
    if (this.isDucked) {
      // Update the target we will restore to; leave ducked level proportional.
      this.preDuckVolume = v;
    } else if (this.xfadeRampId === null) {
      // Mid-crossfade the dual ramp owns deck volumes; it targets the value
      // captured at ramp start, and the next user action re-applies this one.
      this.activeMpv().setVolume(v);
    }
    this.push();
  }

  // ─── Channel B — interrupt ───────────────────────────────────────────────────

  /**
   * Queue a clip for interrupt playback (jingle, announcement, TTS output).
   * Clips play sequentially; music is ducked for the duration.
   */
  playInterrupt(url: string): void {
    const u = url.trim();
    if (!u) return;
    // Deduplicate: if this exact URL is already waiting in the queue, don't stack another copy.
    // Rapid repeated button clicks should enqueue the clip once, not N times.
    if (this.interruptQueue.some((item) => item.url === u)) return;
    this.interruptQueue.push({ url: u });
    this.processQueue();
  }

  /**
   * Immediately stop Channel B and clear its queue.
   * If music was ducked, restore it right away (no ramp).
   */
  stopInterrupt(): void {
    this.interruptQueue.length = 0;
    this.interruptBusy = false;
    this.interruptHasStarted = false;
    this.interruptMpv.stop();
    if (this.isDucked) {
      if (this.rampId !== null) {
        clearInterval(this.rampId);
        this.rampId = null;
      }
      this.isDucked = false;
      this.activeMpv().setVolume(this.preDuckVolume);
    }
    this.push();
  }

  // ─── Ducking ─────────────────────────────────────────────────────────────────

  private processQueue(): void {
    if (this.interruptBusy || this.interruptQueue.length === 0) return;
    const item = this.interruptQueue.shift()!;
    this.interruptBusy = true;
    this.interruptHasStarted = false; // reset: must see start-file before detecting end
    this.duckMusic();
    this.interruptMpv.play(item.url);
  }

  private onInterruptEnd(): void {
    this.interruptBusy = false;
    this.unduckMusic();
    // If more clips are queued, play the next one after a short gap so the
    // unduck ramp doesn't collide with the next duck ramp.
    setTimeout(() => { if (!this.killed) this.processQueue(); }, DUCK_STEPS * DUCK_STEP_MS + 50);
  }

  private duckMusic(): void {
    if (this.isDucked) return;
    // Always snapshot masterVolume, not the deck volume — the MPV volume may be
    // mid-ramp from a previous unduck, which would permanently lower the restore target.
    this.preDuckVolume = this.masterVolume;
    this.isDucked = true;
    const target = Math.max(0, Math.round((this.masterVolume * this.duckPercent) / 100));
    this.rampMusicVolume(this.preDuckVolume, target);
  }

  private unduckMusic(): void {
    if (!this.isDucked) return;
    this.isDucked = false;
    this.rampMusicVolume(this.activeSt().volume, this.preDuckVolume);
  }

  private rampMusicVolume(from: number, to: number): void {
    // Cancel any in-flight duck ramp so duck and unduck never run concurrently.
    if (this.rampId !== null) {
      clearInterval(this.rampId);
      this.rampId = null;
    }
    if (from === to) return;
    const delta = (to - from) / DUCK_STEPS;
    let step = 0;
    this.rampId = setInterval(() => {
      step++;
      const v = step >= DUCK_STEPS ? to : Math.round(from + delta * step);
      this.activeMpv().setVolume(v);
      if (step >= DUCK_STEPS) {
        clearInterval(this.rampId!);
        this.rampId = null;
      }
    }, DUCK_STEP_MS);
  }
}
