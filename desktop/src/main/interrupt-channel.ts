/**
 * Channel B (jingles / announcements / TTS) — the interrupt queue state machine. P0 STEP 0 (owner-approved 2026-10-13).
 *
 * WHY: a clip whose load never started (MPV process down / restarting, IPC gone) left `interruptBusy` set forever →
 * music stayed DUCKED and every later jingle waited behind it; an unreachable URL kept music ducked 30–55 s
 * (standalone-mpv probe: start-file fires at once, end-file(error) only after the network timeout).
 *
 * Owner rules (binding):
 *  1. EXPLICIT failure = immediate recovery: load error of THIS clip, MPV process down / died, cannot start.
 *  2. 10 s = FAILSAFE only: no progress (time-pos advancing) and no completion signal for 10 s → timeout recovery.
 *  3. ONE central cleanup path (`finish`) for success, load error, timeout, MPV death, failure before playback, STOP:
 *     music volume restored · current clip cleared · queue unlocked · next clip continues · timers cleared.
 *  4. `finish` is IDEMPOTENT per clip: error + timeout + process exit together → exactly one recovery / advance.
 *
 * Pure + dependency-injected (no Electron / MPV imports) so it is tested deterministically
 * (desktop/scripts/verify-interrupt-channel.ts). It touches ONLY the interrupt deck (halt = stop Channel B) and the
 * duck; it never stops or reloads music and never uses the global STOP.
 */

/** The subset of MpvStatus the channel reads (Channel B's MpvManager status). */
export type InterruptDeckStatus = {
  status: "idle" | "playing" | "paused" | "stopped";
  position: number;
  lastError: string | null;
  engineReady: boolean;
  attemptId: number;
};

export type InterruptEndReason =
  | "completed" //        natural end of the clip
  | "load_error" //       MPV reported an error for THIS clip before it played audio
  | "playback_error" //   MPV reported an error for THIS clip after it started
  | "engine_down" //      MPV process down / died / IPC lost (before or during the clip)
  | "no_start_timeout" // failsafe: no progress at all within the window
  | "stall_timeout" //    failsafe: progress stopped for the window
  | "stopped"; //         explicit stop (STOP command / designation revoke) — queue cleared

export type InterruptPorts = {
  /** Load + play `url` on the interrupt deck, bound to `attemptId` (MpvManager.play). */
  load(url: string, attemptId: number): void;
  /** Stop the interrupt deck ONLY (MpvManager.stop on Channel B). */
  halt(): void;
  /** Current interrupt-deck status (read-only). */
  status(): InterruptDeckStatus;
  duck(): void;
  /** Restore music volume. `immediate` = no ramp (explicit stop). */
  unduck(immediate: boolean): void;
  /** State changed (the orchestrator pushes its state). */
  changed(): void;
  log(event: string, data: Record<string, unknown>): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
};

/** Failsafe window: no progress / completion signal for this long → timeout recovery. */
export const INTERRUPT_FAILSAFE_MS = 10_000;
/** Interrupt attempt ids live in their own range (Channel B is a separate MPV instance; kept distinct for logs). */
const ATTEMPT_BASE = 9_000_000;

type Current = {
  url: string;
  attemptId: number;
  startedAt: number;
  engineReadyAtLoad: boolean;
  started: boolean;
  progressed: boolean;
  lastPos: number;
  failsafe: unknown;
  /** true while ports.load() runs — a synchronous idle+error push in there = cannot start. */
  loading: boolean;
};

export class InterruptChannel {
  private readonly queue: string[] = [];
  private current: Current | null = null;
  private seq = 0;
  private gapTimer: unknown = null;
  private disposed = false;

  constructor(private readonly ports: InterruptPorts, private readonly gapMs: number) {}

  get busy(): boolean { return this.current !== null; }
  get queueDepth(): number { return this.queue.length; }

  /** Queue a clip (FIFO). Same URL already WAITING → not stacked twice (unchanged dedupe rule). */
  enqueue(url: string): void {
    const u = url.trim();
    if (!u || this.disposed) return;
    if (this.queue.includes(u)) return;
    this.queue.push(u);
    this.pump();
  }

  /** Explicit stop: clear the queue and end the current clip through the SAME cleanup path (volume restored now). */
  stopAll(): void {
    this.queue.length = 0;
    this.clearGap();
    if (this.current) this.finish(this.current.attemptId, "stopped");
    else { this.ports.halt(); this.ports.unduck(true); } // no clip: still unload Channel B + restore a lingering duck
    this.ports.changed();
  }

  /** App shutdown: timers cleared, nothing restarted. */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.clearGap();
    if (this.current) { this.ports.clearTimer(this.current.failsafe); this.current = null; }
  }

  /** Feed every Channel B status push here. */
  onStatus(s: InterruptDeckStatus): void {
    const c = this.current;
    if (!c) return;
    // (1) the engine went away under us (process exit / IPC lost / watchdog restart) — explicit → immediate.
    if (!s.engineReady && c.engineReadyAtLoad) { this.finish(c.attemptId, "engine_down"); return; }
    // (1b) synchronous "cannot start" push from inside load() (no MPV process) — explicit → immediate.
    if (c.loading && s.status === "idle" && s.lastError) { this.finish(c.attemptId, "engine_down"); return; }
    // Everything else must belong to THIS clip (late events of a previous load are ignored).
    if (s.attemptId !== c.attemptId) return;
    if (s.status === "playing") {
      if (!c.started) { c.started = true; c.lastPos = s.position; }
      else if (s.position > c.lastPos) { c.lastPos = s.position; c.progressed = true; this.armFailsafe(c); }
      return;
    }
    if (s.status === "idle" || s.status === "stopped") {
      const reason: InterruptEndReason = s.lastError ? (c.progressed ? "playback_error" : "load_error") : "completed";
      this.finish(c.attemptId, reason);
    }
  }

  private pump(): void {
    if (this.disposed || this.current || this.queue.length === 0) return;
    const url = this.queue.shift()!;
    const attemptId = ATTEMPT_BASE + ++this.seq;
    const c: Current = {
      url, attemptId, startedAt: this.ports.now(), engineReadyAtLoad: this.ports.status().engineReady,
      started: false, progressed: false, lastPos: 0, failsafe: null, loading: true,
    };
    this.current = c;
    this.ports.duck();
    this.armFailsafe(c);
    this.ports.load(url, attemptId);
    if (this.current === c) c.loading = false;
    this.ports.changed();
  }

  private armFailsafe(c: Current): void {
    this.ports.clearTimer(c.failsafe);
    c.failsafe = this.ports.setTimer(() => {
      if (this.current !== c) return;
      this.finish(c.attemptId, c.progressed ? "stall_timeout" : "no_start_timeout");
    }, INTERRUPT_FAILSAFE_MS);
  }

  /** THE ONE cleanup path. Idempotent: only the first call for a given clip does anything. */
  private finish(attemptId: number, reason: InterruptEndReason): void {
    const c = this.current;
    if (!c || c.attemptId !== attemptId) return; // already cleaned up (double failure event) → no-op
    this.current = null; //                         queue unlocked + current cleared FIRST (re-entrancy safe)
    this.ports.clearTimer(c.failsafe); //           timers cleared
    if (reason !== "completed") this.ports.halt(); // a failed / stuck clip is unloaded (Channel B only)
    this.ports.unduck(reason === "stopped"); //     music volume restored
    this.ports.log(reason === "completed" ? "INTERRUPT_END" : "INTERRUPT_ABORT", { reason, attemptId, ms: this.ports.now() - c.startedAt });
    this.ports.changed();
    if (reason !== "stopped") this.scheduleNext(); // next clip continues (after the unduck ramp gap)
  }

  private scheduleNext(): void {
    this.clearGap();
    if (this.queue.length === 0 || this.disposed) return;
    this.gapTimer = this.ports.setTimer(() => { this.gapTimer = null; this.pump(); }, this.gapMs);
  }

  private clearGap(): void {
    if (this.gapTimer !== null) { this.ports.clearTimer(this.gapTimer); this.gapTimer = null; }
  }
}
