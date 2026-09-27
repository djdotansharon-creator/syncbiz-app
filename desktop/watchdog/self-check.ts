/**
 * VONO Watchdog — pure state-machine self-check (no I/O, no app, no installer).
 * Run: `npx tsx desktop/watchdog/self-check.ts` (or compile + node). Demonstrates the 7 states +
 * anti-loop behavior on synthetic heartbeats so the logic is reviewable without a live box.
 */
import path from "node:path";
import { deriveState, decide, initialMemory, initProgressTracker, observeProgress, observeMpvDown, recordAttempt } from "./state-machine";
import { executeRecovery, killWithEscalation, type RecoveryDeps } from "./recovery";
import { startObserver, isValidExe, effectivePidOf, verifyVonoPid } from "./observer";
import { WD, VONO_HEARTBEAT_INTERVAL_MS, taskkillPath, tasklistPath, type VonoHeartbeat, type VonoControlState } from "./contract";

/** Progress facts for a "healthy, well-progressed" attempt (past startup) — the default for the
 *  simple scenario table below. The startup-specific tests A/B/C build their own trackers. */
const PROGRESSED = { progressObserved: true, attemptAgeMs: 120_000 };

const T0 = 1_000_000_000_000;
function hb(over: Partial<VonoHeartbeat> = {}): VonoHeartbeat {
  return {
    schemaVersion: 1, writtenAt: T0, intervalMs: VONO_HEARTBEAT_INTERVAL_MS, pid: 4242,
    appVersion: "2.2.8", sessionStartedAt: T0 - 60_000, bootId: null, branchId: "b1", deviceId: "d1",
    app: { alive: true }, renderer: { alive: null, lastSeenAt: null },
    mpv: { engineReady: true, lastError: null },
    playback: { status: "playing", position: 30, duration: 200, positionAt: T0, attemptId: 7 },
    ...over,
  };
}

type Case = { name: string; hb: VonoHeartbeat | null; control?: VonoControlState | null; appAlive: boolean; now: number; mpvDownForMs?: number };
const cases: Case[] = [
  { name: "HEALTHY", hb: hb(), appAlive: true, now: T0 + 1000 },
  { name: "APP_MISSING (stale hb)", hb: hb({ writtenAt: T0 - 20_000 }), appAlive: true, now: T0 },
  { name: "APP_MISSING (no process)", hb: hb(), appAlive: false, now: T0 + 1000 },
  { name: "MPV_DOWN", hb: hb({ mpv: { engineReady: false, lastError: "engine gone" } }), appAlive: true, now: T0 + 1000, mpvDownForMs: 12_000 },
  { name: "PLAYBACK_STALLED", hb: hb({ playback: { status: "playing", position: 30, duration: 200, positionAt: T0 - 15_000, attemptId: 7 } }), appAlive: true, now: T0 },
  { name: "RENDERER_STALE", hb: hb({ renderer: { alive: false, lastSeenAt: T0 - 30_000 } }), appAlive: true, now: T0 },
  {
    name: "MAINTENANCE (active)", hb: hb({ mpv: { engineReady: false, lastError: "x" } }), appAlive: true, now: T0, mpvDownForMs: 12_000,
    control: { schemaVersion: 1, mode: "maintenance", reason: "tech onsite", source: "admin", createdAt: T0 - 1000, expiresAt: T0 + 60_000, bootId: null },
  },
  {
    name: "MAINTENANCE expired ⇒ not suppressed", hb: hb({ mpv: { engineReady: false, lastError: "x" } }), appAlive: true, now: T0, mpvDownForMs: 12_000,
    control: { schemaVersion: 1, mode: "maintenance", reason: "old", source: "admin", createdAt: T0 - 100_000, expiresAt: T0 - 10_000, bootId: null },
  },
];

let pass = 0;
for (const c of cases) {
  const derived = deriveState({ hb: c.hb, control: c.control ?? null, appProcessAlive: c.appAlive, now: c.now, progress: PROGRESSED, mpvDownForMs: c.mpvDownForMs ?? 0 });
  const d = decide(derived, initialMemory(), c.now);
  // eslint-disable-next-line no-console
  console.log(`${c.name.padEnd(34)} → ${d.state.padEnd(16)} action=${d.action.padEnd(16)} suppressed=${d.suppressed} | ${d.reason}`);
  pass++;
}

// Anti-loop demo: after hitting the app retry limit, further APP_MISSING is suppressed (BACKOFF).
const mem = initialMemory();
mem.windowStartedAt = T0;
mem.attemptsInWindow = 3; // limit reached
const backoff = decide(deriveState({ hb: null, control: null, appProcessAlive: false, now: T0 + 40_000, progress: PROGRESSED, mpvDownForMs: 0 }), mem, T0 + 40_000);
// eslint-disable-next-line no-console
console.log(`anti-loop (limit reached)`.padEnd(34) + ` → ${backoff.state.padEnd(16)} action=${backoff.action.padEnd(16)} suppressed=${backoff.suppressed} | ${backoff.reason}`);

// ── Startup-safety tests (A/B/C) — drive the REAL ProgressTracker across ticks ─────────────────
function assert(name: string, cond: boolean, detail: string): void {
  // eslint-disable-next-line no-console
  console.log(`${cond ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${detail}`);
  if (!cond) process.exitCode = 1;
}
const stateAt = (h: VonoHeartbeat, tr: ReturnType<typeof initProgressTracker>, now: number) => {
  const fresh = { ...h, writtenAt: now }; // keep the heartbeat fresh at `now` so we test STALL, not APP_MISSING
  return deriveState({ hb: fresh, control: null, appProcessAlive: true, now, progress: observeProgress(tr, fresh, now), mpvDownForMs: observeMpvDown(tr, fresh, now) }).state;
};

// A. New URL attempt, 25s with NO progress ⇒ NOT STALLED (still buffering / within startup).
{
  const tr = initProgressTracker();
  const A = T0;
  stateAt(hb({ playback: { status: "playing", position: 0, duration: 200, positionAt: A, attemptId: 100 } }), tr, A); // first sight
  const s = stateAt(hb({ playback: { status: "playing", position: 0, duration: 200, positionAt: A, attemptId: 100 } }), tr, A + 25_000);
  assert("A new attempt, 25s no progress", s !== "PLAYBACK_STALLED", `→ ${s}`);
}

// B. Same attempt progresses, then freezes > 12s (well past startup) ⇒ STALLED.
{
  const tr = initProgressTracker();
  const A = T0;
  stateAt(hb({ playback: { status: "playing", position: 0, duration: 200, positionAt: A, attemptId: 200 } }), tr, A); // first sight
  stateAt(hb({ playback: { status: "playing", position: 5, duration: 200, positionAt: A + 5_000, attemptId: 200 } }), tr, A + 5_000); // real progress
  stateAt(hb({ playback: { status: "playing", position: 40, duration: 200, positionAt: A + 40_000, attemptId: 200 } }), tr, A + 40_000); // more progress
  const froze = hb({ playback: { status: "playing", position: 40, duration: 200, positionAt: A + 40_000, attemptId: 200 } });
  const s = stateAt(froze, tr, A + 40_000 + 15_000); // 15s frozen, attempt age 55s
  assert("B progressed then froze >12s", s === "PLAYBACK_STALLED", `→ ${s}`);
}

// D. LIVE/RADIO (duration=0): attempt proves progress, then position freezes >12s ⇒ STALLED.
{
  const tr = initProgressTracker();
  const A = T0;
  const live = (pos: number, at: number) => hb({ playback: { status: "playing", position: pos, duration: 0, positionAt: at, attemptId: 400 } });
  stateAt(live(0, A), tr, A);                       // first sight (live, duration 0)
  stateAt(live(6, A + 6_000), tr, A + 6_000);       // real progress on the live stream
  stateAt(live(45, A + 45_000), tr, A + 45_000);    // more progress (past startup grace)
  const s = stateAt(live(45, A + 45_000), tr, A + 45_000 + 15_000); // frozen 15s, attempt age 60s
  assert("D live/radio (duration=0) froze >12s", s === "PLAYBACK_STALLED", `→ ${s}`);
}

// C. attemptId changes ⇒ stall history reset ⇒ the fresh attempt is NOT immediately STALLED.
{
  const tr = initProgressTracker();
  const A = T0;
  // First attempt progresses and would be stallable.
  stateAt(hb({ playback: { status: "playing", position: 0, duration: 200, positionAt: A, attemptId: 300 } }), tr, A);
  stateAt(hb({ playback: { status: "playing", position: 30, duration: 200, positionAt: A + 30_000, attemptId: 300 } }), tr, A + 30_000);
  // New attempt appears (e.g. skip/redispatch), no progress yet, even 25s later.
  const B = A + 60_000;
  stateAt(hb({ playback: { status: "playing", position: 0, duration: 200, positionAt: B, attemptId: 301 } }), tr, B); // first sight of new attempt
  const s = stateAt(hb({ playback: { status: "playing", position: 0, duration: 200, positionAt: B, attemptId: 301 } }), tr, B + 25_000);
  assert("C attemptId change resets stall history", s !== "PLAYBACK_STALLED", `→ ${s} (progressObserved reset)`);
}

// E. Process lifetime — the observe loop must keep the Node process alive 24/7 (NOT unref'd).
//    hasRef()===true proves the active interval will hold the event loop open across every tick, so
//    the observer survives past the first tick until an explicit shutdown. We clear it immediately
//    (well before the first 2s tick) so this check itself performs zero file I/O and lets the test exit.
{
  const t = startObserver();
  const refd = typeof (t as { hasRef?: () => boolean }).hasRef === "function"
    ? (t as { hasRef: () => boolean }).hasRef()
    : true;
  assert("E observer loop keeps process alive (timer ref'd, not unref'd)", refd === true, `hasRef=${refd}`);
  clearInterval(t);
}

// H1/H2. APP_MISSING splits by process liveness (blocker fix): hung app (PID alive) ⇒ restart,
//        dead process ⇒ launch. Keeps 7 states; the action layer disambiguates via appProcessAlive.
{
  const staleHb = hb({ writtenAt: T0 - 20_000 });
  const h1 = decide(deriveState({ hb: staleHb, control: null, appProcessAlive: true, now: T0, progress: PROGRESSED, mpvDownForMs: 0 }), initialMemory(), T0);
  assert("H1 hb stale + PID alive ⇒ restart_app", h1.state === "APP_MISSING" && h1.action === "restart_app" && !h1.suppressed, `${h1.action} | ${h1.reason}`);
  const h2 = decide(deriveState({ hb: staleHb, control: null, appProcessAlive: false, now: T0, progress: PROGRESSED, mpvDownForMs: 0 }), initialMemory(), T0);
  assert("H2 hb stale + PID dead ⇒ launch_app", h2.state === "APP_MISSING" && h2.action === "launch_app" && !h2.suppressed, `${h2.action} | ${h2.reason}`);
}

// F. MPV_DOWN grace — engineReady=false is NOT escalated until it has been down >= WD.mpvDownGraceMs
//    (so the app's own MPV respawn gets first crack; the watchdog never fights it).
{
  const down = hb({ mpv: { engineReady: false, lastError: "engine gone" } });
  const early = deriveState({ hb: { ...down, writtenAt: T0 }, control: null, appProcessAlive: true, now: T0, progress: PROGRESSED, mpvDownForMs: WD.mpvDownGraceMs - 1 }).state;
  const late = deriveState({ hb: { ...down, writtenAt: T0 }, control: null, appProcessAlive: true, now: T0, progress: PROGRESSED, mpvDownForMs: WD.mpvDownGraceMs }).state;
  assert("F MPV down < grace ⇒ not MPV_DOWN", early !== "MPV_DOWN", `→ ${early}`);
  assert("F MPV down ≥ grace ⇒ MPV_DOWN", late === "MPV_DOWN", `→ ${late}`);
}

// ── Recovery executor tests (G) — fake OS deps; no real spawn/kill ──────────────
type FakeOpts = { diesOnGraceful?: boolean; diesOnForce?: boolean };
function fakeDeps(initialAlive: boolean, opts: FakeOpts = {}): RecoveryDeps & { calls: string[] } {
  const calls: string[] = [];
  let alive = initialAlive;
  let clock = 0;
  const deps = {
    isValidExe: (_p: string) => true, // default valid; overridden per-test for I1
    isVonoPid: (_pid: number) => alive, // default: a live pid is VONO; overridden for J (reused pid)
    launch: (p: string) => { calls.push(`launch:${p}`); return true; },
    killTree: (pid: number, force: boolean) => {
      calls.push(`kill:${force ? "force" : "graceful"}:${pid}`);
      if (force && opts.diesOnForce !== false) alive = false;
      if (!force && opts.diesOnGraceful) alive = false;
      return true;
    },
    isAlive: (_pid: number) => alive,
    sleep: async (ms: number) => { clock += ms; },
    now: () => clock,
    log: (_l: string) => { /* quiet in tests */ },
    calls,
  };
  return deps;
}
const first = (calls: string[], pred: (c: string) => boolean) => calls.findIndex(pred);

async function recoveryTests(): Promise<void> {
  // G1: APP_MISSING + pid dead ⇒ launch once, no kill.
  {
    const d = fakeDeps(false);
    const r = await executeRecovery({ action: "launch_app", fromState: "APP_MISSING", pid: 123, execPath: "VONO.exe" }, d);
    assert("G1 launch_app launches when pid dead", r.ok && d.calls.some((c) => c.startsWith("launch:")) && !d.calls.some((c) => c.startsWith("kill:")), d.calls.join(","));
  }
  // G2: launch_app skipped when pid still alive (no duplicate).
  {
    const d = fakeDeps(true);
    const r = await executeRecovery({ action: "launch_app", fromState: "APP_MISSING", pid: 123, execPath: "VONO.exe" }, d);
    assert("G2 launch_app skipped when pid alive (no duplicate)", !r.ok && !d.calls.some((c) => c.startsWith("launch:")), d.calls.join(","));
  }
  // G3: restart_app ⇒ kill BEFORE launch (graceful kill succeeds).
  {
    const d = fakeDeps(true, { diesOnGraceful: true });
    const r = await executeRecovery({ action: "restart_app", fromState: "MPV_DOWN", pid: 123, execPath: "VONO.exe" }, d);
    const ki = first(d.calls, (c) => c.startsWith("kill:"));
    const li = first(d.calls, (c) => c.startsWith("launch:"));
    assert("G3 restart kills before launch", r.ok && ki >= 0 && li > ki && !d.calls.includes("kill:force:123"), d.calls.join(","));
  }
  // G4: restart_app ⇒ graceful fails, escalate to force, then launch.
  {
    const d = fakeDeps(true, { diesOnGraceful: false, diesOnForce: true });
    const r = await executeRecovery({ action: "restart_app", fromState: "PLAYBACK_STALLED", pid: 123, execPath: "VONO.exe" }, d);
    const g = first(d.calls, (c) => c === "kill:graceful:123");
    const f = first(d.calls, (c) => c === "kill:force:123");
    const l = first(d.calls, (c) => c.startsWith("launch:"));
    assert("G4 force escalation then launch", r.ok && g >= 0 && f > g && l > f, d.calls.join(","));
  }
  // G5: restart_app ⇒ process never dies ⇒ NO launch (never a duplicate).
  {
    const d = fakeDeps(true, { diesOnGraceful: false, diesOnForce: false });
    const r = await executeRecovery({ action: "restart_app", fromState: "MPV_DOWN", pid: 123, execPath: "VONO.exe" }, d);
    assert("G5 unkillable ⇒ no launch (no duplicate)", !r.ok && !d.calls.some((c) => c.startsWith("launch:")), d.calls.join(","));
  }
  // G6: reload_renderer is reserved ⇒ no kill, no launch.
  {
    const d = fakeDeps(true);
    const r = await executeRecovery({ action: "reload_renderer", fromState: "RENDERER_STALE", pid: 123, execPath: "VONO.exe" }, d);
    assert("G6 reload_renderer reserved (no action)", r.ok && d.calls.length === 0, d.calls.join(","));
  }
  // G7: anti-loop — decide() suppresses at cooldown, window limit, and the hourly ceiling.
  {
    const appMissing = deriveState({ hb: null, control: null, appProcessAlive: false, now: T0, progress: PROGRESSED, mpvDownForMs: 0 });
    // ceiling: 6 restarts within the hour ⇒ SAFE_HOLD.
    const memCeil = initialMemory(); memCeil.restartTimestamps = Array.from({ length: 6 }, (_, i) => T0 - i * 1000);
    const ceil = decide(appMissing, memCeil, T0 + 40_000);
    assert("G7a ceiling ⇒ suppressed (SAFE_HOLD)", ceil.suppressed && ceil.action === "none", ceil.reason);
    // cooldown: last attempt 1s ago (< 30s).
    const memCool = initialMemory(); memCool.lastAttemptAt = T0 - 1000;
    const cool = decide(appMissing, memCool, T0);
    assert("G7b cooldown ⇒ suppressed", cool.suppressed, cool.reason);
    // window limit: 3 app attempts already this window.
    const memWin = initialMemory(); memWin.windowStartedAt = T0; memWin.attemptsInWindow = 3;
    const win = decide(appMissing, memWin, T0 + 40_000);
    assert("G7c window limit ⇒ suppressed (BACKOFF)", win.suppressed, win.reason);
    // recordAttempt math.
    const m = initialMemory(); recordAttempt(m, "restart_app", T0);
    assert("G7d recordAttempt advances counters", m.attemptsInWindow === 1 && m.restartTimestamps.length === 1 && m.recoveryInFlightUntil === T0 + WD.recoveryConfirmMs, JSON.stringify({ a: m.attemptsInWindow, r: m.restartTimestamps.length }));
  }
  // H3: APP_MISSING + hung PID ⇒ restart ordering (kill → confirm dead → launch).
  {
    const d = fakeDeps(true, { diesOnGraceful: true });
    const r = await executeRecovery({ action: "restart_app", fromState: "APP_MISSING", pid: 777, execPath: "VONO.exe" }, d);
    const ki = first(d.calls, (c) => c.startsWith("kill:"));
    const li = first(d.calls, (c) => c.startsWith("launch:"));
    assert("H3 hung app restart: kill before launch", r.ok && ki >= 0 && li > ki, d.calls.join(","));
  }
  // H4: APP_MISSING + hung PID that cannot be killed ⇒ NO launch (never a duplicate).
  {
    const d = fakeDeps(true, { diesOnGraceful: false, diesOnForce: false });
    const r = await executeRecovery({ action: "restart_app", fromState: "APP_MISSING", pid: 777, execPath: "VONO.exe" }, d);
    assert("H4 hung unkillable ⇒ no launch (no duplicate)", !r.ok && !d.calls.some((c) => c.startsWith("launch:")), d.calls.join(","));
  }
  // I1: invalid/tampered execPath ⇒ executor rejects ⇒ NO launch (executor-level, via isValidExe dep).
  {
    const d = fakeDeps(false); d.isValidExe = () => false;
    const r = await executeRecovery({ action: "launch_app", fromState: "APP_MISSING", pid: null, execPath: "C:\\tmp\\evil.exe" }, d);
    assert("I1 executor rejects invalid execPath ⇒ no launch", !r.ok && r.detail === "execPath rejected" && !d.calls.some((c) => c.startsWith("launch:")), r.detail);
  }
  // I1b: invalid execPath on restart ⇒ NOT even killed (never stop a running app we can't relaunch).
  {
    const d = fakeDeps(true); d.isValidExe = () => false;
    const r = await executeRecovery({ action: "restart_app", fromState: "MPV_DOWN", pid: 888, execPath: "C:\\tmp\\evil.exe" }, d);
    assert("I1b invalid execPath on restart ⇒ no kill/launch", !r.ok && d.calls.length === 0, d.calls.join(","));
  }
  // J1: cached/effective PID is ALIVE but NOT VONO (e.g. chrome.exe after PID reuse) on a restart ⇒
  //     the foreign process is NEVER killed; a fresh VONO is launched instead.
  {
    const d = fakeDeps(true); d.isVonoPid = () => false; // alive, but image ≠ VONO
    const r = await executeRecovery({ action: "restart_app", fromState: "APP_MISSING", pid: 4444, execPath: "VONO.exe" }, d);
    assert("J1 alive non-VONO pid ⇒ NO kill, launch fresh", r.ok && !d.calls.some((c) => c.startsWith("kill:")) && d.calls.some((c) => c.startsWith("launch:")), d.calls.join(","));
  }
  // J2: cached PID alive AND image = VONO ⇒ restart_app kills then launches.
  {
    const d = fakeDeps(true, { diesOnGraceful: true }); // isVonoPid default true
    const r = await executeRecovery({ action: "restart_app", fromState: "APP_MISSING", pid: 123, execPath: "VONO.exe" }, d);
    const ki = first(d.calls, (c) => c.startsWith("kill:"));
    const li = first(d.calls, (c) => c.startsWith("launch:"));
    assert("J2 alive VONO pid ⇒ restart (kill before launch)", r.ok && ki >= 0 && li > ki, d.calls.join(","));
  }
  // J3: heartbeat PID alive but WRONG executable ⇒ that process must NOT be killed (launch_app path).
  {
    const d = fakeDeps(true); d.isVonoPid = () => false;
    const r = await executeRecovery({ action: "launch_app", fromState: "APP_MISSING", pid: 5555, execPath: "VONO.exe" }, d);
    assert("J3 wrong-exe pid ⇒ not killed, launch allowed", r.ok && !d.calls.some((c) => c.startsWith("kill:")) && d.calls.some((c) => c.startsWith("launch:")), d.calls.join(","));
  }
}

// I1/I2 (real validation) + I5 (absolute taskkill) — sync checks on the real functions.
assert("I1 real: wrong-basename exe rejected", isValidExe(process.execPath) === false, path.basename(process.execPath));
assert("I1 real: relative path rejected", isValidExe("SyncBiz Player.exe") === false, "relative");
assert("I2 real: missing executable rejected", isValidExe("C:\\nope\\does-not-exist\\SyncBiz Player.exe") === false, "missing");
assert("I5 taskkill uses absolute System32 path", path.isAbsolute(taskkillPath()) && /system32[\\/]+taskkill\.exe$/i.test(taskkillPath()), taskkillPath());
assert("J4 tasklist uses absolute System32 path", path.isAbsolute(tasklistPath()) && /system32[\\/]+tasklist\.exe$/i.test(tasklistPath()), tasklistPath());
// J (real): this very process is ALIVE but is NOT a VONO executable ⇒ verifyVonoPid MUST reject it,
// proving a reused/foreign live PID can never be treated as VONO (and thus never killed) from cache.
assert("J real: live non-VONO pid (this process) rejected", verifyVonoPid(process.pid) === false, `pid=${process.pid}`);
assert("J real: dead pid rejected", verifyVonoPid(2147483000) === false, "dead");
// I3: heartbeat missing + lastKnownPid alive ⇒ effective pid = lastKnownPid ⇒ restart_app.
{
  const eff = effectivePidOf(undefined, 555);
  const decided = decide(deriveState({ hb: null, control: null, appProcessAlive: true, now: T0, progress: PROGRESSED, mpvDownForMs: 0 }), initialMemory(), T0);
  assert("I3 hb missing + lastKnownPid alive ⇒ restart_app", eff === 555 && decided.action === "restart_app", `eff=${eff} action=${decided.action}`);
}
// I4: heartbeat missing + lastKnownPid dead/none ⇒ launch_app.
{
  const eff = effectivePidOf(undefined, null);
  const decided = decide(deriveState({ hb: null, control: null, appProcessAlive: false, now: T0, progress: PROGRESSED, mpvDownForMs: 0 }), initialMemory(), T0);
  assert("I4 hb missing + no live pid ⇒ launch_app", eff === null && decided.action === "launch_app", `eff=${eff} action=${decided.action}`);
}

recoveryTests().then(() => {
  // eslint-disable-next-line no-console
  console.log(`\n${pass} scenarios evaluated.`);
});
