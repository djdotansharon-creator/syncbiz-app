/**
 * VONO Watchdog — READ-ONLY observer (POC / PR-B).
 *
 * Independent process. Each tick it reads heartbeat.json + control.json, probes whether a VONO
 * process is alive, runs the PURE state machine, and LOGS state transitions + the action it WOULD
 * take. It executes NO recovery and spawns nothing (that is PR-C). Fully offline: pure local file +
 * process inspection, zero network.
 */

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  WD,
  type VonoHeartbeat,
  type VonoControlState,
} from "./contract";
import {
  deriveState,
  decide,
  initialMemory,
  initProgressTracker,
  observeProgress,
  type WatchdogMemory,
  type ProgressTracker,
  type Decision,
} from "./state-machine";

// ── Paths (mirror desktop/src/main/vono-paths.ts) ─────────────────────────────
function vonoRoot(): string {
  if (process.platform === "win32") return path.join(process.env.ProgramData || "C:\\ProgramData", "VONO");
  return path.join(os.tmpdir(), "VONO");
}
function stateDir(): string {
  return path.join(vonoRoot(), "state");
}
function logsDir(): string {
  const d = path.join(vonoRoot(), "logs");
  try { mkdirSync(d, { recursive: true }); } catch { /* best effort */ }
  return d;
}
const heartbeatPath = () => path.join(stateDir(), "heartbeat.json");
const controlPath = () => path.join(stateDir(), "control.json");
const watchdogLogPath = () => path.join(logsDir(), "watchdog.log");

// ── Safe readers (never throw; a missing/partial file just reads as null) ──────
function readJson<T>(p: string): T | null {
  try {
    const raw = readFileSync(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Read-only liveness probe: signal 0 tests existence without affecting the process. */
function isProcessAlive(pid: number | undefined | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = exists but not ours (still alive); ESRCH = gone.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  // eslint-disable-next-line no-console
  console.log(stamped);
  try { appendFileSync(watchdogLogPath(), stamped + "\n"); } catch { /* best effort */ }
}

// ── One evaluation tick (pure-ish: only reads files + logs) ───────────────────
export interface TickResult {
  decision: Decision;
  changed: boolean;
}

export function tick(mem: WatchdogMemory, tracker: ProgressTracker, prevState: string | null, now = Date.now()): TickResult {
  const hb = readJson<VonoHeartbeat>(heartbeatPath());
  const control = readJson<VonoControlState>(controlPath());
  const appProcessAlive = isProcessAlive(hb?.pid);
  const progress = observeProgress(tracker, hb, now); // read-only sampling; new attemptId resets history

  const derived = deriveState({ hb, control, appProcessAlive, now, progress });
  const decision = decide(derived, mem, now);
  const changed = decision.state !== prevState;

  if (changed) {
    log(
      `[STATE] ${prevState ?? "—"} → ${decision.state} | reason="${decision.reason}" | ` +
      `wouldAction=${decision.action}${decision.suppressed ? " (suppressed)" : ""} | ` +
      `hb=${hb ? "fresh" : "missing"} pid=${hb?.pid ?? "?"} appAlive=${appProcessAlive} ` +
      `mpvReady=${hb?.mpv.engineReady ?? "?"} status=${hb?.playback.status ?? "?"} ` +
      `attempt=${hb?.playback.attemptId ?? "?"} progressSeen=${progress.progressObserved} attemptAgeMs=${progress.attemptAgeMs}`
    );
  }
  return { decision, changed };
}

// ── Loop ───────────────────────────────────────────────────────────────────────
/**
 * Start the observe loop and return its timer handle. The timer is deliberately NOT `unref()`'d:
 * this loop is the observer's whole reason to live, so the active interval keeps the Node process
 * running 24/7. The process exits only on an explicit shutdown/termination (SIGINT/SIGTERM/kill), or
 * when a caller `clearInterval()`s the returned handle. Importing this module runs nothing (the loop
 * starts only under `require.main` or when a caller invokes `startObserver()`), so tests are side-effect free.
 */
export function startObserver(): ReturnType<typeof setInterval> {
  const mem = initialMemory();
  const tracker = initProgressTracker();
  let prevState: string | null = null;
  const timer = setInterval(() => {
    const { decision } = tick(mem, tracker, prevState);
    prevState = decision.state;
  }, WD.TICK_MS);
  // NOTE: no timer.unref() — see the doc-comment above. An unref'd loop would let Node exit
  // immediately when this is the only active handle, killing the watchdog after zero ticks.
  return timer;
}

if (require.main === module) {
  log(`[BOOT] VONO Watchdog observer (READ-ONLY POC) tick=${WD.TICK_MS}ms root=${vonoRoot()}`);
  startObserver();
}
