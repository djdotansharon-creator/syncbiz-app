/**
 * VONO Watchdog — pure state-machine self-check (no I/O, no app, no installer).
 * Run: `npx tsx desktop/watchdog/self-check.ts` (or compile + node). Demonstrates the 7 states +
 * anti-loop behavior on synthetic heartbeats so the logic is reviewable without a live box.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { deriveState, decide, initialMemory, initProgressTracker, observeProgress, observeMpvDown, recordAttempt } from "./state-machine";
import { acquireLock, type LockDeps, type LockRecord } from "./watchdog-lock";
import { executeRecovery, killWithEscalation, type RecoveryDeps } from "./recovery";
import { startObserver, isValidExe, effectivePidOf, verifyVonoPid, launchDetached } from "./observer";
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
type FakeOpts = {
  diesOnGraceful?: boolean;
  diesOnForce?: boolean;
  killFails?: boolean; // killTree returns false and never flips alive (simulates taskkill failure)
  isVonoSeq?: boolean[]; // scripted isVonoPid results per call (sticks to last) — for TOCTOU tests
  isVonoConst?: boolean; // constant isVonoPid override
};
function fakeDeps(initialAlive: boolean, opts: FakeOpts = {}): RecoveryDeps & { calls: string[] } {
  const calls: string[] = [];
  let alive = initialAlive;
  let clock = 0;
  let vonoCall = 0;
  const isVono = (): boolean => {
    if (opts.isVonoSeq) { const a = opts.isVonoSeq; const v = a[Math.min(vonoCall, a.length - 1)]; vonoCall++; return v; }
    if (typeof opts.isVonoConst === "boolean") return opts.isVonoConst;
    return alive; // default: a live pid is VONO
  };
  const deps = {
    isValidExe: (_p: string) => true, // default valid; overridden per-test for I1
    isVonoPid: (_pid: number) => isVono(),
    launch: (p: string) => { calls.push(`launch:${p}`); return true; },
    killTree: (pid: number, force: boolean) => {
      calls.push(`kill:${force ? "force" : "graceful"}:${pid}`);
      if (opts.killFails) return false; // taskkill failed — process stays alive
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
  // K1: verified VONO at decision, but identity flips to non-VONO BEFORE the graceful kill ⇒ NO kill.
  {
    const d = fakeDeps(true, { isVonoSeq: [true, false] }); // executor check=true, pre-graceful check=false
    const r = await executeRecovery({ action: "restart_app", fromState: "APP_MISSING", pid: 900, execPath: "VONO.exe" }, d);
    assert("K1 identity flips before graceful ⇒ NO kill", r.ok && !d.calls.some((c) => c.startsWith("kill:")), d.calls.join(","));
  }
  // K2: graceful kill issued, our VONO dies, SAME pid becomes another process (still alive) ⇒ NO force kill.
  {
    const d = fakeDeps(true, { diesOnGraceful: false, isVonoSeq: [true, true, false] }); // flips after graceful
    const r = await executeRecovery({ action: "restart_app", fromState: "APP_MISSING", pid: 901, execPath: "VONO.exe" }, d);
    assert("K2 pid reused after graceful ⇒ NO force kill", d.calls.includes("kill:graceful:901") && !d.calls.some((c) => c.startsWith("kill:force")), d.calls.join(","));
  }
  // K3: identity stays VONO ⇒ graceful → force → confirm dead → launch.
  {
    const d = fakeDeps(true, { diesOnGraceful: false, diesOnForce: true, isVonoConst: true });
    const r = await executeRecovery({ action: "restart_app", fromState: "MPV_DOWN", pid: 902, execPath: "VONO.exe" }, d);
    const g = first(d.calls, (c) => c === "kill:graceful:902");
    const f = first(d.calls, (c) => c === "kill:force:902");
    const l = first(d.calls, (c) => c.startsWith("launch:"));
    assert("K3 stays VONO ⇒ graceful→force→launch", r.ok && g >= 0 && f > g && l > f, d.calls.join(","));
  }
  // K4: VONO spawn emits error ⇒ recovery FAILED, watchdog survives (fake launch resolves false).
  {
    const d = fakeDeps(false); d.launch = () => Promise.resolve(false);
    const r = await executeRecovery({ action: "launch_app", fromState: "APP_MISSING", pid: null, execPath: "VONO.exe" }, d);
    assert("K4 spawn error ⇒ recovery FAILED (no throw)", !r.ok && r.detail === "spawn failed", r.detail);
  }
  // K4 (real): a bad exe path resolves false from the real launcher and never throws.
  {
    const ok = await launchDetached("C:\\nope\\does-not-exist\\SyncBiz Player.exe");
    assert("K4 real: launchDetached bad path ⇒ false (no crash)", ok === false, `ok=${ok}`);
  }
  // K5: taskkill fails and the process never dies ⇒ NO launch (never blind-launch over a live VONO).
  {
    const d = fakeDeps(true, { killFails: true, isVonoConst: true });
    const r = await executeRecovery({ action: "restart_app", fromState: "MPV_DOWN", pid: 903, execPath: "VONO.exe" }, d);
    assert("K5 taskkill fails + alive ⇒ NO launch, survives", !r.ok && !d.calls.some((c) => c.startsWith("launch:")), d.calls.join(","));
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

// ── Single-watchdog lock (L/N) — atomic, owner-token, full-path identity; never kills ───────────
const BUNDLED_NODE = "C:\\install\\vono-watchdog\\node.exe";
type Vfs = { rec: LockRecord | null; unlinkNoop?: boolean };
type World = { pidAlive?: (p: number) => boolean; execPath?: (p: number) => string | null; cmdLine?: (p: number) => string | null };
function lockInstance(vfs: Vfs, id: { ownerId: string; pid: number; nodePath?: string; entryPath?: string }, world: World): { deps: LockDeps; calls: string[] } {
  const calls: string[] = [];
  const nodePath = id.nodePath ?? BUNDLED_NODE;
  const entryPath = id.entryPath ?? "C:\\install\\vono-watchdog\\watchdog.cjs";
  const deps: LockDeps = {
    lockPath: "L", ownerId: id.ownerId, pid: id.pid, nodePath, entryPath, now: () => 1, log: () => { /* quiet */ },
    openExclusive: () => {
      if (vfs.rec) { calls.push("EEXIST"); return null; }
      vfs.rec = { ownerId: id.ownerId, pid: id.pid, createdAt: 1, nodePath, entryPath };
      calls.push("open:ok"); return 1;
    },
    writeLock: () => { /* rec already set by openExclusive in the fake */ },
    closeFd: () => { /* noop */ },
    readLock: () => vfs.rec,
    unlink: () => { calls.push("unlink"); if (!vfs.unlinkNoop) vfs.rec = null; },
    isProcessAlive: (p) => (world.pidAlive ? world.pidAlive(p) : false),
    processExecPath: (p) => (world.execPath ? world.execPath(p) : null),
    processCommandLine: (p) => (world.cmdLine ? world.cmdLine(p) : null),
  };
  return { deps, calls };
}
{
  // Free ⇒ atomic acquire; owner release removes (N4).
  const vfs: Vfs = { rec: null };
  const a = lockInstance(vfs, { ownerId: "A", pid: 10 }, {});
  const h = acquireLock(a.deps);
  assert("L free ⇒ acquired (atomic)", h !== null && a.calls.includes("open:ok"), a.calls.join(","));
  h?.release();
  assert("N4 owner release ⇒ lock removed", vfs.rec === null && a.calls.includes("unlink"), a.calls.join(","));
}
{
  // Dead-pid lock ⇒ reclaim then acquire.
  const vfs: Vfs = { rec: { ownerId: "old", pid: 22, createdAt: 1, nodePath: BUNDLED_NODE, entryPath: "x" } };
  const a = lockInstance(vfs, { ownerId: "A", pid: 10 }, { pidAlive: () => false });
  const h = acquireLock(a.deps);
  assert("L dead-pid ⇒ reclaim + acquire", h !== null && a.calls.includes("unlink") && a.calls.includes("open:ok"), a.calls.join(","));
}
{
  // N1: lock pid alive but running node.exe from ANOTHER path ⇒ foreign/stale ⇒ reclaim, never active.
  const vfs: Vfs = { rec: { ownerId: "old", pid: 700, createdAt: 1, nodePath: "C:\\Other\\node.exe", entryPath: "y" } };
  const a = lockInstance(vfs, { ownerId: "A", pid: 10 }, { pidAlive: () => true, execPath: () => "C:\\Other\\node.exe", cmdLine: () => "node some-other-app.js" });
  const h = acquireLock(a.deps);
  assert("N1 reused node.exe from another path ⇒ reclaim (not active watchdog)", h !== null && a.calls.includes("unlink"), a.calls.join(","));
}
{
  // N2: old loses ownership, new acquires; old.release() MUST NOT delete the new owner's lock.
  const vfs: Vfs = { rec: null };
  const world: World = { pidAlive: (p) => p === 10 /* only NEW is alive; OLD(10?)*/, execPath: () => BUNDLED_NODE, cmdLine: () => "node watchdog.cjs" };
  const oldInst = lockInstance(vfs, { ownerId: "OLD", pid: 99 }, world);
  const oldH = acquireLock(oldInst.deps); // OLD owns (vfs empty)
  // OLD's pid becomes dead; NEW acquires (reclaims OLD's stale lock).
  const newInst = lockInstance(vfs, { ownerId: "NEW", pid: 10 }, world);
  const newH = acquireLock(newInst.deps);
  const newOwns = vfs.rec?.ownerId === "NEW";
  oldH?.release(); // OLD exits AFTER NEW owns — must be a no-op
  assert("N2 old release ⇒ does NOT delete new owner's lock", newH !== null && newOwns && vfs.rec?.ownerId === "NEW", `rec=${vfs.rec?.ownerId}`);
}
{
  // N3: two simultaneous acquirers on the same lock ⇒ exactly one owner.
  const vfs: Vfs = { rec: null };
  const world: World = { pidAlive: () => true, execPath: () => BUNDLED_NODE, cmdLine: () => "node watchdog.cjs" };
  const A = lockInstance(vfs, { ownerId: "A", pid: 1 }, world);
  const B = lockInstance(vfs, { ownerId: "B", pid: 2 }, world);
  const ha = acquireLock(A.deps); // A wins the atomic create
  const hb = acquireLock(B.deps); // B sees a LIVE own-watchdog lock ⇒ exits
  const owners = [ha, hb].filter((h) => h !== null).length;
  assert("N3 two simultaneous ⇒ exactly one owner", owners === 1 && ha !== null && hb === null && vfs.rec?.ownerId === "A", `owners=${owners}`);
}
{
  // Unverifiable exec path (null) ⇒ conservative: treat as live watchdog, exit (no steal).
  const vfs: Vfs = { rec: { ownerId: "old", pid: 800, createdAt: 1, nodePath: BUNDLED_NODE, entryPath: "z" } };
  const a = lockInstance(vfs, { ownerId: "A", pid: 10 }, { pidAlive: () => true, execPath: () => null });
  const h = acquireLock(a.deps);
  assert("L unverifiable exec path ⇒ exit, no steal", h === null && !a.calls.includes("unlink"), a.calls.join(","));
}
{
  // Bounded — if reclaim can't clear the lock, acquire returns null (no infinite loop).
  const vfs: Vfs = { rec: { ownerId: "old", pid: 555, createdAt: 1, nodePath: BUNDLED_NODE, entryPath: "q" }, unlinkNoop: true };
  const a = lockInstance(vfs, { ownerId: "A", pid: 10 }, { pidAlive: () => false });
  const h = acquireLock(a.deps);
  assert("L unclearable lock ⇒ bounded null (no loop)", h === null, a.calls.join(","));
}

// ── Scheduled Task XML sanity (M) — the exact required settings are present ─────────────────────
{
  const xml = readFileSync(path.join(__dirname, "..", "scripts", "provisioning", "vono-protection.task.xml"), "utf8");
  const need = [
    "<LogonTrigger>", "<UserId>{{STATION_USER}}</UserId>", "<LogonType>InteractiveToken</LogonType>",
    "<RunLevel>LeastPrivilege</RunLevel>", "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>", "<StartWhenAvailable>true</StartWhenAvailable>",
    "<AllowStartOnDemand>true</AllowStartOnDemand>", "<Interval>PT1M</Interval>", "<Count>3</Count>",
    "{{INSTALL_DIR}}\\vono-watchdog\\node.exe", "{{INSTALL_DIR}}\\vono-watchdog\\watchdog.cjs",
  ];
  const missing = need.filter((s) => !xml.includes(s));
  assert("M task XML has required settings", missing.length === 0, missing.length ? `missing: ${missing.join(" | ")}` : "all present");
  assert("M task XML: non-elevated (no HighestAvailable)", !xml.includes("HighestAvailable"), "no HighestAvailable");
}

recoveryTests().then(() => {
  // eslint-disable-next-line no-console
  console.log(`\n${pass} scenarios evaluated.`);
});
