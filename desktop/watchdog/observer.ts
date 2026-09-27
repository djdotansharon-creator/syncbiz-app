/**
 * VONO Watchdog — observer + recovery loop (PR-C).
 *
 * Independent process. Each tick it reads heartbeat.json + control.json, probes whether a VONO
 * process is alive, runs the PURE state machine, and — when the decision is actionable and NOT
 * suppressed (cooldown / per-window limit / hourly ceiling / maintenance) — EXECUTES a bounded
 * recovery action (launch / restart) via the injected executor, records the attempt for anti-loop,
 * and appends to restart-history. Fully offline: local files + process control only, zero network.
 * Not bundled into the Electron app (desktop tsconfig compiles src/** only).
 */

import { readFileSync, appendFileSync, writeFileSync, renameSync, existsSync, statSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, readlinkSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

import {
  WD,
  defaultVonoExePath,
  isExpectedVonoBasename,
  taskkillPath,
  tasklistPath,
  type VonoHeartbeat,
  type VonoControlState,
} from "./contract";
import {
  deriveState,
  decide,
  initialMemory,
  initProgressTracker,
  observeProgress,
  observeMpvDown,
  recordAttempt,
  type WatchdogMemory,
  type ProgressTracker,
  type Decision,
} from "./state-machine";
import { executeRecovery, type RecoveryDeps } from "./recovery";
import { acquireLock, type LockDeps } from "./watchdog-lock";

// ── Paths (mirror desktop/src/main/vono-paths.ts) ─────────────────────────────
function vonoRoot(): string {
  // VONO_STATE_ROOT override is for tests only (clean-machine bootstrap); production uses ProgramData.
  if (process.env.VONO_STATE_ROOT) return process.env.VONO_STATE_ROOT;
  if (process.platform === "win32") return path.join(process.env.ProgramData || "C:\\ProgramData", "VONO");
  return path.join(os.tmpdir(), "VONO");
}
/** Returns …\VONO\state, CREATING it (recursive) — the watchdog may start on a clean machine before
 *  VONO has ever run, so this must bootstrap C:\ProgramData\VONO\state itself (else wx lock ⇒ ENOENT). */
export function stateDir(): string {
  const d = path.join(vonoRoot(), "state");
  try { mkdirSync(d, { recursive: true }); } catch { /* best effort */ }
  return d;
}
/** Returns …\VONO\logs, creating it (recursive) — independent of state dir. */
export function logsDir(): string {
  const d = path.join(vonoRoot(), "logs");
  try { mkdirSync(d, { recursive: true }); } catch { /* best effort */ }
  return d;
}
const heartbeatPath = () => path.join(stateDir(), "heartbeat.json");
const controlPath = () => path.join(stateDir(), "control.json");
const watchdogLogPath = () => path.join(logsDir(), "watchdog.log");
const restartHistoryPath = () => path.join(logsDir(), "restart-history.json");
const cachePath = () => path.join(stateDir(), "watchdog-cache.json"); // last-known execPath, LOCAL only
const lockPath = () => path.join(stateDir(), "watchdog.lock"); // single-watchdog lock, LOCAL only

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

// ── Local cache (LOCAL ONLY: last-known exe + pid; no tokens/urls; atomic writes) ──
interface WatchdogCache { lastKnownExecPath: string | null; lastKnownPid: number | null; updatedAt: number; }
function loadCache(): WatchdogCache {
  const c = readJson<Partial<WatchdogCache>>(cachePath());
  return {
    lastKnownExecPath: typeof c?.lastKnownExecPath === "string" ? c.lastKnownExecPath : null,
    lastKnownPid: typeof c?.lastKnownPid === "number" ? c.lastKnownPid : null,
    updatedAt: typeof c?.updatedAt === "number" ? c.updatedAt : 0,
  };
}
function saveCacheAtomic(c: WatchdogCache): void {
  try {
    const tmp = cachePath() + ".tmp";
    writeFileSync(tmp, JSON.stringify(c), "utf8");
    renameSync(tmp, cachePath()); // atomic replace — reader never sees a partial file
  } catch { /* best effort */ }
}

// ── execPath validation — the ONLY paths the watchdog will ever spawn ──────────
// Must be absolute, exist, be a regular file, and have an allowlisted VONO/SyncBiz basename. This is
// the guard against spawning a tampered heartbeat/cache value; there is NO PATH lookup fallback.
export function isValidExe(execPath: string | null | undefined): boolean {
  try {
    if (!execPath || !path.isAbsolute(execPath)) return false;
    if (!existsSync(execPath)) return false;
    if (!statSync(execPath).isFile()) return false;
    return isExpectedVonoBasename(path.basename(execPath));
  } catch {
    return false;
  }
}

/** The pid to probe/kill: the heartbeat's pid, else the last-known pid (heartbeat may be gone while
 *  the app is still alive/hung). Pure — exported for tests. */
export function effectivePidOf(hbPid: number | null | undefined, lastKnownPid: number | null): number | null {
  return hbPid ?? lastKnownPid ?? null;
}

/** Extract a process image basename for `pid` from the OS, or null if it can't be determined.
 *  Windows: absolute System32\tasklist.exe, args array, shell:false, CSV/no-header. Non-Windows (dev):
 *  `ps -p <pid> -o comm=`. Never a PATH lookup for tasklist. */
export function processImageName(pid: number): string | null {
  try {
    if (process.platform === "win32") {
      const res = spawnSync(tasklistPath(), ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", shell: false });
      const out = (res.stdout || "").trim();
      // No matching task ⇒ tasklist prints an INFO line, not a CSV row starting with a quote.
      if (!out || !out.startsWith("\"")) return null;
      const firstField = out.slice(1, out.indexOf("\"", 1)); // image name is the first CSV field
      return firstField || null;
    }
    const res = spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", shell: false });
    const name = (res.stdout || "").trim();
    return name ? path.basename(name) : null;
  } catch {
    return null;
  }
}

/**
 * VONO IDENTITY CHECK — the ONLY basis for killing a pid. Returns true ONLY when pid is alive AND its
 * process image is an allowlisted VONO executable. Guards against Windows PID reuse: after a reboot the
 * cached/last-known pid may belong to an unrelated process, so we NEVER act on a pid by liveness alone.
 */
export function verifyVonoPid(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  if (!isProcessAlive(pid)) return false;
  const image = processImageName(pid);
  if (!image) return false; // unknown image ⇒ do NOT treat as VONO, do NOT kill
  return isExpectedVonoBasename(image);
}

// ── Full process identity (exec path + command line) — for the watchdog LOCK ownership check ────
// Basename alone is insufficient (PID reuse + any node.exe). On Windows we read the FULL ExecutablePath
// and CommandLine via absolute PowerShell + CIM (one call, memoized briefly). Non-Windows (dev): /proc.
let procInfoMemo: { pid: number; at: number; exe: string | null; cmd: string | null } | null = null;
function winPowershellPath(): string {
  const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return `${sysRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}
function queryProcessInfo(pid: number): { exe: string | null; cmd: string | null } {
  if (procInfoMemo && procInfoMemo.pid === pid && Date.now() - procInfoMemo.at < 3000) {
    return { exe: procInfoMemo.exe, cmd: procInfoMemo.cmd };
  }
  let exe: string | null = null;
  let cmd: string | null = null;
  try {
    if (process.platform === "win32") {
      const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; "$($p.ExecutablePath)|CMD|$($p.CommandLine)"`;
      const res = spawnSync(winPowershellPath(), ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", shell: false });
      const out = (res.stdout || "").trim();
      if (out) {
        const [e, c] = out.split("|CMD|");
        exe = e && e.trim() ? e.trim() : null;
        cmd = c && c.trim() ? c.trim() : null;
      }
    } else {
      try { exe = readlinkSync(`/proc/${pid}/exe`); } catch { exe = null; }
      try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim() || null; } catch { cmd = null; }
    }
  } catch {
    exe = null; cmd = null;
  }
  procInfoMemo = { pid, at: Date.now(), exe, cmd };
  return { exe, cmd };
}
export function processExecPath(pid: number): string | null { return queryProcessInfo(pid).exe; }
export function processCommandLine(pid: number): string | null { return queryProcessInfo(pid).cmd; }

// ── Bounded restart-history ring (audit trail of executed actions) ────────────
function appendRestartHistory(entry: Record<string, unknown>): void {
  try {
    const arr = readJson<Record<string, unknown>[]>(restartHistoryPath()) ?? [];
    arr.push({ at: Date.now(), ...entry });
    const trimmed = arr.slice(-WD.restartHistoryMax);
    writeFileSync(restartHistoryPath(), JSON.stringify(trimmed), "utf8");
  } catch { /* best effort — never throw into the loop */ }
}

// ── Real OS recovery deps (the executor's ladder/ordering is tested with fakes) ──
// SECURITY: every process control here uses the argv-array form of spawn with `shell: false` — the
// executable path and each argument are passed SEPARATELY and are NEVER concatenated into a shell
// command string. So an execPath/cache value (or a pid) can never be interpreted by a shell; there is
// no command interpolation / injection surface.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Launch a fresh detached VONO. Resolves true ONLY on a successful "spawn" event, false on "error"
 * (e.g. ENOENT / not executable). The async "error" listener is ALWAYS attached, so a failed spawn can
 * never surface as an unhandled EventEmitter 'error' that crashes the watchdog. Exported for tests.
 */
export function launchDetached(execPath: string, spawnFn: typeof spawn = spawn): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
    try {
      // cwd = the install dir (the directory holding execPath) so the launched VONO does NOT inherit the
      // watchdog's cwd (<install>\vono-watchdog) — inheriting it breaks mpv/runtime-binary resolution and
      // no mpv engines spawn (proven by A/B field test). Detached + unref keeps VONO independent of the
      // watchdog; shell:false ⇒ execPath is the executable, never a shell command line (no interpolation).
      const child = spawnFn(execPath, [], { cwd: path.dirname(execPath), detached: true, stdio: "ignore", shell: false });
      child.once("error", (e) => { log(`[RECOVERY] launch spawn error: ${(e as Error).message}`); done(false); });
      child.once("spawn", () => { try { child.unref(); } catch { /* ignore */ } done(true); });
    } catch (e) {
      log(`[RECOVERY] launch threw synchronously: ${(e as Error).message}`);
      done(false);
    }
  });
}

const realDeps: RecoveryDeps = {
  isValidExe,
  isVonoPid: verifyVonoPid,
  launch: (execPath: string) => launchDetached(execPath),
  killTree: (pid: number, force: boolean): boolean => {
    try {
      if (process.platform === "win32") {
        // spawnSync (no async 'error' to leak) with the ABSOLUTE System32\taskkill.exe (never PATH),
        // an ARGUMENT ARRAY (never an interpolated command string), shell:false.
        const args = force ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid), "/T"];
        const res = spawnSync(taskkillPath(), args, { stdio: "ignore", shell: false });
        if (res.error) { log(`[RECOVERY] taskkill spawn error (force=${force}): ${res.error.message}`); return false; }
        return true;
      }
      process.kill(pid, force ? "SIGKILL" : "SIGTERM"); // dev fallback (non-Windows): numeric pid + signal
      return true;
    } catch (e) {
      log(`[RECOVERY] killTree error (force=${force}): ${(e as Error).message}`);
      return false;
    }
  },
  isAlive: (pid: number) => isProcessAlive(pid),
  sleep,
  now: () => Date.now(),
  log,
};

// ── One evaluation tick (reads files + logs; returns the decision + the heartbeat for the loop) ──
export interface TickResult {
  decision: Decision;
  changed: boolean;
  effectivePid: number | null; // heartbeat pid, else last-known pid (for probing + kill target)
  execPath: string | null; // resolved exe to (re)launch
}

export function tick(mem: WatchdogMemory, tracker: ProgressTracker, cache: WatchdogCache, prevState: string | null, now = Date.now()): TickResult {
  const hb = readJson<VonoHeartbeat>(heartbeatPath());
  const control = readJson<VonoControlState>(controlPath());

  // Refresh the local cache from a live heartbeat (so a later missing/corrupt heartbeat can still find
  // the app's pid + exe). If the heartbeat is gone, fall back to the last-known values.
  if (hb?.pid) cache.lastKnownPid = hb.pid;
  if (hb?.execPath) cache.lastKnownExecPath = hb.execPath;

  // Effective pid: heartbeat's pid, else last-known — so "heartbeat missing but app still alive/hung"
  // is detected (⇒ restart), NOT mistaken for a dead one (⇒ launch).
  const effectivePid = effectivePidOf(hb?.pid, cache.lastKnownPid);
  // A FRESH heartbeat means the app is writing it right now ⇒ definitionally a live VONO (no tasklist
  // needed). Only when the heartbeat is stale/missing do we VERIFY the pid's identity (image name),
  // never trusting a possibly-reused pid by liveness alone.
  const hbFresh = !!hb && now - hb.writtenAt <= WD.appStaleMs;
  const appProcessAlive = hbFresh ? true : verifyVonoPid(effectivePid);
  const execPath = hb?.execPath ?? cache.lastKnownExecPath ?? defaultVonoExePath() ?? null;

  const progress = observeProgress(tracker, hb, now); // read-only sampling; new attemptId resets history
  const mpvDownForMs = observeMpvDown(tracker, hb, now);

  const derived = deriveState({ hb, control, appProcessAlive, now, progress, mpvDownForMs });
  const decision = decide(derived, mem, now);
  const changed = decision.state !== prevState;

  if (changed) {
    log(
      `[STATE] ${prevState ?? "—"} → ${decision.state} | reason="${decision.reason}" | ` +
      `wouldAction=${decision.action}${decision.suppressed ? " (suppressed)" : ""} | ` +
      `hb=${hb ? "fresh" : "missing"} pid=${effectivePid ?? "?"} appAlive=${appProcessAlive} ` +
      `mpvReady=${hb?.mpv.engineReady ?? "?"} status=${hb?.playback.status ?? "?"} mpvDownForMs=${mpvDownForMs} ` +
      `attempt=${hb?.playback.attemptId ?? "?"} progressSeen=${progress.progressObserved} attemptAgeMs=${progress.attemptAgeMs}`
    );
  }
  return { decision, changed, effectivePid, execPath };
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
  const cache = loadCache();
  const cacheKey = (c: WatchdogCache) => `${c.lastKnownExecPath}|${c.lastKnownPid}`;
  let lastCacheKey = cacheKey(cache);
  let prevState: string | null = null;
  let executing = false; // guard: a restart can take up to ~8s while ticks fire every 2s

  const timer = setInterval(() => {
    const { decision, effectivePid, execPath } = tick(mem, tracker, cache, prevState);
    prevState = decision.state;

    // Persist the local cache (last-known exe/pid) atomically only when it actually changed.
    const key = cacheKey(cache);
    if (key !== lastCacheKey) {
      cache.updatedAt = Date.now();
      saveCacheAtomic(cache);
      lastCacheKey = key;
    }

    // Execute ONLY when the decision is actionable AND not suppressed (all anti-loop / cooldown /
    // ceiling / maintenance gating already happened in decide()), and no action is already running.
    const actionable = decision.action !== "none" && decision.action !== "await_recovery";
    if (!actionable || decision.suppressed || executing) return;

    executing = true;
    const ctx = { action: decision.action, fromState: decision.state, pid: effectivePid, execPath };
    // Record the attempt up front so overlapping ticks + the next decide() see the cooldown/ceiling.
    recordAttempt(mem, decision.action, Date.now());
    void executeRecovery(ctx, realDeps)
      .then((res) => {
        appendRestartHistory({ fromState: decision.state, action: res.action, pid: ctx.pid, ok: res.ok, detail: res.detail });
        log(`[RECOVERY] ${res.action} → ${res.ok ? "OK" : "FAILED"} (${res.detail})`);
      })
      .catch((e) => log(`[RECOVERY] executor threw: ${(e as Error).message}`))
      .finally(() => { executing = false; });
  }, WD.TICK_MS);
  // NOTE: no timer.unref() — see the doc-comment above. An unref'd loop would let Node exit
  // immediately when this is the only active handle, killing the watchdog after zero ticks.
  return timer;
}

/** Real single-watchdog lock deps: atomic wx create; per-instance ownerId; identity by FULL exec path
 *  (never basename alone); owner-matched release; never kills. Exported for the clean-bootstrap test. */
export function realLockDeps(): LockDeps {
  stateDir(); // CREATES …\VONO\state (recursive) before the exclusive create — clean-machine bootstrap
  return {
    lockPath: lockPath(),
    ownerId: randomUUID(),
    pid: process.pid,
    nodePath: process.execPath, // our bundled node.exe (full path)
    entryPath: process.argv[1] || __filename, // watchdog.cjs (full path)
    now: () => Date.now(),
    log,
    openExclusive: (p: string): number | null => {
      try { return openSync(p, "wx"); } // atomic exclusive create — throws EEXIST if present
      catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return null; throw e; }
    },
    writeLock: (fd: number, data: string) => { writeSync(fd, data); },
    closeFd: (fd: number) => { closeSync(fd); },
    readLock: (p: string) => readJson<import("./watchdog-lock").LockRecord>(p),
    unlink: (p: string) => { unlinkSync(p); },
    isProcessAlive: (pid: number) => isProcessAlive(pid),
    processExecPath: (pid: number) => processExecPath(pid),
    processCommandLine: (pid: number) => processCommandLine(pid),
  };
}

if (require.main === module) {
  const lock = acquireLock(realLockDeps());
  if (!lock) {
    log(`[BOOT] another watchdog owns the lock — exiting cleanly`);
    process.exit(0);
  }
  const release = () => { try { lock.release(); } catch { /* ignore */ } };
  process.on("exit", release);
  process.on("SIGINT", () => { release(); process.exit(0); });
  process.on("SIGTERM", () => { release(); process.exit(0); });
  log(`[BOOT] VONO Watchdog observer + recovery (PR-C) tick=${WD.TICK_MS}ms root=${vonoRoot()}`);
  startObserver();
}
