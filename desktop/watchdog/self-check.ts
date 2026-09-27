/**
 * VONO Watchdog — pure state-machine self-check (no I/O, no app, no installer).
 * Run: `npx tsx desktop/watchdog/self-check.ts` (or compile + node). Demonstrates the 7 states +
 * anti-loop behavior on synthetic heartbeats so the logic is reviewable without a live box.
 */
import { deriveState, decide, initialMemory, initProgressTracker, observeProgress } from "./state-machine";
import { VONO_HEARTBEAT_INTERVAL_MS, type VonoHeartbeat, type VonoControlState } from "./contract";

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

type Case = { name: string; hb: VonoHeartbeat | null; control?: VonoControlState | null; appAlive: boolean; now: number };
const cases: Case[] = [
  { name: "HEALTHY", hb: hb(), appAlive: true, now: T0 + 1000 },
  { name: "APP_MISSING (stale hb)", hb: hb({ writtenAt: T0 - 20_000 }), appAlive: true, now: T0 },
  { name: "APP_MISSING (no process)", hb: hb(), appAlive: false, now: T0 + 1000 },
  { name: "MPV_DOWN", hb: hb({ mpv: { engineReady: false, lastError: "engine gone" } }), appAlive: true, now: T0 + 1000 },
  { name: "PLAYBACK_STALLED", hb: hb({ playback: { status: "playing", position: 30, duration: 200, positionAt: T0 - 15_000, attemptId: 7 } }), appAlive: true, now: T0 },
  { name: "RENDERER_STALE", hb: hb({ renderer: { alive: false, lastSeenAt: T0 - 30_000 } }), appAlive: true, now: T0 },
  {
    name: "MAINTENANCE (active)", hb: hb({ mpv: { engineReady: false, lastError: "x" } }), appAlive: true, now: T0,
    control: { schemaVersion: 1, mode: "maintenance", reason: "tech onsite", source: "admin", createdAt: T0 - 1000, expiresAt: T0 + 60_000, bootId: null },
  },
  {
    name: "MAINTENANCE expired ⇒ not suppressed", hb: hb({ mpv: { engineReady: false, lastError: "x" } }), appAlive: true, now: T0,
    control: { schemaVersion: 1, mode: "maintenance", reason: "old", source: "admin", createdAt: T0 - 100_000, expiresAt: T0 - 10_000, bootId: null },
  },
];

let pass = 0;
for (const c of cases) {
  const derived = deriveState({ hb: c.hb, control: c.control ?? null, appProcessAlive: c.appAlive, now: c.now, progress: PROGRESSED });
  const d = decide(derived, initialMemory(), c.now);
  // eslint-disable-next-line no-console
  console.log(`${c.name.padEnd(34)} → ${d.state.padEnd(16)} action=${d.action.padEnd(16)} suppressed=${d.suppressed} | ${d.reason}`);
  pass++;
}

// Anti-loop demo: after hitting the app retry limit, further APP_MISSING is suppressed (BACKOFF).
const mem = initialMemory();
mem.windowStartedAt = T0;
mem.attemptsInWindow = 3; // limit reached
const backoff = decide(deriveState({ hb: null, control: null, appProcessAlive: false, now: T0 + 40_000, progress: PROGRESSED }), mem, T0 + 40_000);
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
  return deriveState({ hb: fresh, control: null, appProcessAlive: true, now, progress: observeProgress(tr, fresh, now) }).state;
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

// eslint-disable-next-line no-console
console.log(`\n${pass} scenarios evaluated.`);
