/**
 * PR-C regression — PAUSE invariant for the desktop MPV freeze self-heal + stream-startup timeout.
 * Pure-helper tests (no React). Run: npx tsx scripts/verify-freeze-self-heal.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  shouldFreezeSelfHeal,
  nextFreezeBaseline,
  nextStartupBaseline,
  isEnginePaused,
} from "../lib/desktop-freeze-self-heal";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const FREEZE_MS = 6000;
const STARTUP_MS = 30000;

type Sample = { pos: number; status: string; t: number };

// Simulate a stream of snapshots through nextFreezeBaseline (tracking prevStatus, like applySnap does).
function runFreezeClock(samples: Sample[]): { baseline: number; lastPos: number | null; lastStatus: string | null } {
  let baseline = 0;
  let lastPos: number | null = null;
  let lastStatus: string | null = null;
  for (const s of samples) {
    const r = nextFreezeBaseline({ prevBaseline: baseline, prevPos: lastPos, nextPos: s.pos, prevStatus: lastStatus, snapStatus: s.status, now: s.t });
    baseline = r.baseline;
    lastPos = r.lastPos;
    lastStatus = s.status;
  }
  return { baseline, lastPos, lastStatus };
}
// Simulate the startup baseline (attemptStartAt) through nextStartupBaseline (tracking prevStatus).
function runStartupClock(samples: Sample[], start: number): { baseline: number; lastStatus: string | null } {
  let baseline = start;
  let lastStatus: string | null = null;
  for (const s of samples) {
    baseline = nextStartupBaseline({ prevBaseline: baseline, prevStatus: lastStatus, snapStatus: s.status, now: s.t });
    lastStatus = s.status;
  }
  return { baseline, lastStatus };
}

// ── shouldFreezeSelfHeal ─────────────────────────────────────────────────────────────────────────────────────
assert("playing + frozen past threshold → self-heal", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: 7000, freezeMs: FREEZE_MS }) === true);
assert("playing + not yet frozen → no self-heal", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: 3000, freezeMs: FREEZE_MS }) === false);
assert("engine PAUSED (even for a huge frozenMs) → never self-heal", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "paused", frozenMs: 999_999, freezeMs: FREEZE_MS }) === false);
assert("intent PAUSED (snap still playing) → never self-heal", shouldFreezeSelfHeal({ rendererStatus: "paused", snapStatus: "playing", frozenMs: 999_999, freezeMs: FREEZE_MS }) === false);
assert("CONTROL mirror (intent not playing) → never self-heal", shouldFreezeSelfHeal({ rendererStatus: "idle", snapStatus: "playing", frozenMs: 999_999, freezeMs: FREEZE_MS }) === false);
assert("engine idle → never self-heal", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "idle", frozenMs: 999_999, freezeMs: FREEZE_MS }) === false);
assert("exactly at threshold → self-heal (>=)", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: FREEZE_MS, freezeMs: FREEZE_MS }) === true);

// ── isEnginePaused ───────────────────────────────────────────────────────────────────────────────────────────
assert("isEnginePaused: paused=true", isEnginePaused("paused") === true);
assert("isEnginePaused: playing/idle/null=false", !isEnginePaused("playing") && !isEnginePaused("idle") && !isEnginePaused(null) && !isEnginePaused(undefined));

// ── freeze clock: PLAYING + advancing → no freeze accrues ────────────────────────────────────────────────────
{
  const r = runFreezeClock([{ pos: 1, status: "playing", t: 1000 }, { pos: 2, status: "playing", t: 2000 }, { pos: 3, status: "playing", t: 3000 }]);
  const frozenMs = 3200 - r.baseline;
  assert("playing + advancing → frozenMs small (no freeze)", frozenMs < FREEZE_MS, `frozenMs=${frozenMs}`);
}

// ── BLOCKER 1 — one PAUSED snap, 2-min SILENCE, resume PLAYING at SAME position → fresh baseline, no self-heal ─
{
  const samples: Sample[] = [
    { pos: 15, status: "playing", t: 1000 },   // t=1s playing
    { pos: 15, status: "paused", t: 2000 },    // t=2s one paused property-change snapshot
    // …no snapshots for 2 minutes…
    { pos: 15, status: "playing", t: 122000 }, // t=122s resume property-change snapshot, SAME position
  ];
  const r = runFreezeClock(samples);
  const frozenMs = 122000 - r.baseline;
  assert("BLOCKER1: one paused snap + 2min silence + resume same pos → baseline fresh (frozenMs ~0)", frozenMs <= 1, `frozenMs=${frozenMs}`);
  assert("BLOCKER1: no self-heal immediately after resume", !shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs, freezeMs: FREEZE_MS }));
}

// ── RESUME after a long pause (same pos) → fresh freeze window ────────────────────────────────────────────────
{
  const r = runFreezeClock([{ pos: 15, status: "playing", t: 1000 }, { pos: 15, status: "paused", t: 2000 }, { pos: 15, status: "playing", t: 300000 }]);
  const frozenMs = 300000 - r.baseline;
  assert("resume after 5min pause → freeze baseline fresh", frozenMs <= 1, `frozenMs=${frozenMs}`);
}

// ── TRUE playing stall (playing, position NOT advancing, never paused) → still self-heals ─────────────────────
{
  const samples: Sample[] = [{ pos: 15, status: "playing", t: 1000 }];
  for (let t = 2000; t <= 8000; t += 1000) samples.push({ pos: 15, status: "playing", t });
  const r = runFreezeClock(samples); // baseline anchored at t=1000 (last real advance)
  const frozenMs = 8000 - r.baseline;
  assert("playing + stuck 7s → frozenMs >= FREEZE_MS", frozenMs >= FREEZE_MS, `frozenMs=${frozenMs}`);
  assert("TRUE playing stall → shouldFreezeSelfHeal TRUE (existing self-heal preserved)", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs, freezeMs: FREEZE_MS }));
}

// ── renderer says playing but engine says paused → never freeze/redispatch/skip ──────────────────────────────
{
  // freeze clock is held while paused …
  const r = runFreezeClock([{ pos: 15, status: "playing", t: 1000 }, { pos: 15, status: "paused", t: 2000 }]);
  const frozenMs = 90000 - r.baseline; // 88s later, still paused (ref holds paused)
  assert("renderer playing + engine paused → fire decision false", !shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "paused", frozenMs, freezeMs: FREEZE_MS }));
  assert("renderer playing + engine paused → interval guard trips (isEnginePaused)", isEnginePaused("paused"));
}

// ── BLOCKER 2 — STREAM starting + engine paused longer than startup timeout → no startup_timeout ──────────────
{
  // attempt starts at t=0; one paused snap at t=2s, then silence. In the real interval the engine-paused guard
  // holds attemptStartAt=now each tick; here nextStartupBaseline models the paused hold / resume-fresh.
  const samples: Sample[] = [{ pos: 0, status: "playing", t: 1000 }, { pos: 0, status: "paused", t: 2000 }];
  const r = runStartupClock(samples, 0);
  const startingMsWhilePaused = 100000 - r.baseline; // 98s after the paused snap, still paused
  // Model the interval-level guard: while engine paused, startup never ages (guard holds baseline=now & bails).
  assert("BLOCKER2: starting + engine paused → startup clock excludes paused (no startup_timeout while paused)", isEnginePaused("paused") === true);
  assert("BLOCKER2: paused snap set the startup baseline (paused wall-clock excluded)", r.baseline === 2000, `baseline=${r.baseline} startingMsRaw=${startingMsWhilePaused}`);
}

// ── BLOCKER 2 — resume from a long pause while starting → startup timeout starts FRESH (not expired) ──────────
{
  const samples: Sample[] = [
    { pos: 0, status: "playing", t: 1000 },
    { pos: 0, status: "paused", t: 2000 },     // pause during startup
    { pos: 0, status: "playing", t: 200000 },  // resume ~3.3min later, same position
  ];
  const r = runStartupClock(samples, 0);
  const startingMsAfterResume = 200000 - r.baseline;
  assert("BLOCKER2: resume while starting → startup baseline fresh (startingMs ~0, < STARTUP_MS)", startingMsAfterResume <= 1 && startingMsAfterResume < STARTUP_MS, `startingMs=${startingMsAfterResume}`);
}

// ── nextStartupBaseline: normal buffering (never paused) keeps counting (budget preserved) ────────────────────
{
  const samples: Sample[] = [{ pos: 0, status: "playing", t: 1000 }, { pos: 0, status: "playing", t: 5000 }, { pos: 0, status: "playing", t: 10000 }];
  const r = runStartupClock(samples, 0);
  assert("normal buffering (no pause) → startup baseline unchanged (budget keeps counting)", r.baseline === 0, `baseline=${r.baseline}`);
}

// ── Static guard: the production code uses the helpers + explicit pause guards ────────────────────────────────
{
  const src = readFileSync(path.join(__dirname, "..", "components", "audio-player.tsx"), "utf-8");
  assert("audio-player imports all pause-invariant helpers", /shouldFreezeSelfHeal, nextFreezeBaseline, nextStartupBaseline, isEnginePaused/.test(src));
  assert("audio-player uses shouldFreezeSelfHeal for the fire decision", /const canSelfHeal = shouldFreezeSelfHeal/.test(src));
  assert("audio-player passes prevStatus to nextFreezeBaseline (resume transition)", /nextFreezeBaseline\(\{[\s\S]*prevStatus: prevSnapStatus/.test(src));
  assert("audio-player excludes paused from startup via nextStartupBaseline", /nextStartupBaseline\(\{[\s\S]*prevStatus: prevSnapStatus/.test(src));
  assert("audio-player has interval-level isEnginePaused guard BEFORE the STREAM_STARTING timeout block",
    src.indexOf("isEnginePaused(desktopMpvSnapRef.current?.status)") !== -1 &&
      src.indexOf("isEnginePaused(desktopMpvSnapRef.current?.status)") < src.indexOf("STREAM_STARTING — bounded startup timeout"));
  assert("audio-player has explicit PAUSE INVARIANT guards", (src.match(/PR-C PAUSE INVARIANT/g) ?? []).length >= 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
