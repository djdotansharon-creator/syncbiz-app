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
/** Standby deck must reach "playing" within this window or the crossfade aborts
 *  (YouTube URLs resolve through yt-dlp and can take several seconds). */
const XFADE_LOAD_TIMEOUT_MS = 12_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrchestratorState = {
  /** Music playback status (the ACTIVE deck; volume field is display-stable). */
  music: MpvStatus;
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

  private activeSt(): MpvStatus {
    return this.activeMusicDeck === "A" ? this.musicStA : this.musicStB;
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
    const active = this.activeSt();
    return {
      music: {
        ...active,
        /* Display-stable volume: mid-crossfade the deck volumes ramp internally,
           but the operator's fader must not slide on its own. Duck stays visible
           (that dip is a product feature the operator expects to see). */
        volume: this.isDucked ? active.volume : this.masterVolume,
      },
      interrupt: { ...this.interruptSt },
      isDucked: this.isDucked,
      masterVolume: this.masterVolume,
      duckTargetVolume: Math.max(0, Math.round((this.masterVolume * this.duckPercent) / 100)),
      duckPercent: this.duckPercent,
      interruptBusy: this.interruptBusy,
      interruptQueueDepth: this.interruptQueue.length,
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

  playMusic(url: string): void {
    const u = url.trim();
    if (!u) return;
    console.log(ORCH, "playMusic (→ active deck loadfile/replace)", { preview: u.slice(0, 200), deck: this.activeMusicDeck });
    this.abortXfade("cold_play_request");
    this.activeMpv().setVolume(this.currentMusicTarget());
    this.activeMpv().play(u);
  }

  /**
   * TRUE A/B crossfade: the incoming track loads on the standby deck at volume 0
   * and only when it actually starts playing do both decks ramp (out/in) over
   * `fadeSec`, then the decks swap and the old one stops. If the incoming track
   * never starts, the current track keeps playing untouched.
   */
  playMusicCrossfade(url: string, fadeSec: number): void {
    const u = url.trim();
    if (!u) return;

    const activeStatus = this.activeSt().status;
    if (activeStatus !== "playing" && activeStatus !== "paused") {
      // Nothing audible to fade from — clean start, no dip.
      console.log(ORCH, "playMusicCrossfade → cold start (active deck idle)", { preview: u.slice(0, 120) });
      this.playMusic(u);
      return;
    }

    // A crossfade already mid-flight? Settle it instantly (swap if the incoming
    // deck is audible, drop it otherwise) so the new request starts clean.
    this.settleXfadeNow("new_crossfade_request");

    const standby = this.standbyMpv();
    console.log(ORCH, "playMusicCrossfade → A/B overlap", {
      preview: u.slice(0, 200),
      fadeSec,
      activeDeck: this.activeMusicDeck,
      standbyDeck: this.standbyDeckId(),
    });
    this.xfadePending = { fadeSec };
    this.xfadeStandbySawPlaying = false;
    standby.setVolume(0);
    standby.play(u);
    this.xfadeStartTimeoutId = setTimeout(() => {
      // Incoming track never started (bad URL / yt-dlp failure): keep the
      // business audio alive on the current track — never fade into silence.
      console.warn(ORCH, "crossfade standby load timeout — keeping current track", { preview: u.slice(0, 120) });
      this.abortXfade("standby_load_timeout");
    }, XFADE_LOAD_TIMEOUT_MS);
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
