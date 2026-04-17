/**
 * Desktop Playback Orchestrator — the single gatekeeper above both MPV instances.
 *
 * Architecture rules (enforced here):
 *  - Nothing outside this class calls MpvManager directly.
 *  - Channel A (music)     = continuous background playback.
 *  - Channel B (interrupt) = jingles / announcements / TTS, queued FIFO.
 *  - Ducking ramps Channel A volume down when Channel B starts,
 *    and back up when Channel B ends.
 */

import { MpvManager, type MpvStatus } from "./mpv-manager";

// ─── Ducking constants ────────────────────────────────────────────────────────
/** Default duck depth: Channel A falls to this % of masterVolume while Channel B plays.
 *  Exposed as a runtime-configurable field so the test panel can tune it live. */
const DUCK_PERCENT_DEFAULT = 40;
/** Number of volume steps in each ramp (up or down). */
const DUCK_STEPS = 8;
/** Milliseconds between each ramp step. */
const DUCK_STEP_MS = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrchestratorState = {
  /** Channel A — continuous music playback status. */
  music: MpvStatus;
  /** Channel B — interrupt channel status. */
  interrupt: MpvStatus;
  isDucked: boolean;
  masterVolume: number;
  /** Volume Channel A is ramped to when ducked (= masterVolume * duckPercent / 100). */
  duckTargetVolume: number;
  /** Configurable duck depth 0–100 (% of masterVolume Channel A is held at during interrupt). */
  duckPercent: number;
  /** true if Channel B has a file loaded or queued. */
  interruptBusy: boolean;
  /** How many clips are waiting behind the current interrupt. */
  interruptQueueDepth: number;
};

type StatusListener = (state: OrchestratorState) => void;

type InterruptItem = { url: string };

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class PlaybackOrchestrator {
  private readonly musicMpv: MpvManager;
  private readonly interruptMpv: MpvManager;

  private musicSt: MpvStatus = { status: "idle", position: 0, duration: 0, volume: 80 };
  private interruptSt: MpvStatus = { status: "idle", position: 0, duration: 0, volume: 80 };

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

  /** Handle to the active volume-ramp timer. Cancelled before any new ramp starts. */
  private rampId: ReturnType<typeof setInterval> | null = null;

  private listener: StatusListener | null = null;

  constructor() {
    this.musicMpv = new MpvManager("syncbiz-music");
    this.interruptMpv = new MpvManager("syncbiz-interrupt");

    this.musicMpv.onStatus((s) => {
      this.musicSt = s;
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

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    this.musicMpv.start();
    this.interruptMpv.start();
  }

  kill(): void {
    this.killed = true;
    if (this.rampId !== null) {
      clearInterval(this.rampId);
      this.rampId = null;
    }
    this.musicMpv.kill();
    this.interruptMpv.kill();
  }

  // ─── Status ──────────────────────────────────────────────────────────────────

  onStatus(fn: StatusListener): void {
    this.listener = fn;
  }

  getState(): OrchestratorState {
    return {
      music: { ...this.musicSt },
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

  playMusic(url: string): void {
    const u = url.trim();
    if (!u) return;
    this.musicMpv.play(u);
  }

  pauseMusic(): void {
    this.musicMpv.pause();
  }

  resumeMusic(): void {
    this.musicMpv.resume();
  }

  stopMusic(): void {
    this.musicMpv.stop();
  }

  /** Seek Channel A to an absolute position in seconds. */
  seekMusic(seconds: number): void {
    this.musicMpv.seek(seconds);
  }

  /** Set duck depth 0–100 (percent of masterVolume Channel A falls to during interrupt). */
  setDuckPercent(n: number): void {
    this.duckPercent = Math.max(0, Math.min(100, Math.round(n)));
    this.push();
  }

  /** Set master volume (0–100). Applies to Channel A immediately unless ducked. */
  setVolume(n: number): void {
    const v = Math.max(0, Math.min(100, Math.round(n)));
    this.masterVolume = v;
    if (this.isDucked) {
      // Update the target we will restore to; leave ducked level proportional.
      this.preDuckVolume = v;
    } else {
      this.musicMpv.setVolume(v);
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
      this.musicMpv.setVolume(this.preDuckVolume);
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
    // Always snapshot masterVolume, not musicSt.volume — the MPV volume may be
    // mid-ramp from a previous unduck, which would permanently lower the restore target.
    this.preDuckVolume = this.masterVolume;
    this.isDucked = true;
    const target = Math.max(0, Math.round((this.masterVolume * this.duckPercent) / 100));
    this.rampMusicVolume(this.preDuckVolume, target);
  }

  private unduckMusic(): void {
    if (!this.isDucked) return;
    this.isDucked = false;
    this.rampMusicVolume(this.musicSt.volume, this.preDuckVolume);
  }

  private rampMusicVolume(from: number, to: number): void {
    // Cancel any in-flight ramp so duck and unduck never run concurrently.
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
      this.musicMpv.setVolume(v);
      if (step >= DUCK_STEPS) {
        clearInterval(this.rampId!);
        this.rampId = null;
      }
    }, DUCK_STEP_MS);
  }
}
