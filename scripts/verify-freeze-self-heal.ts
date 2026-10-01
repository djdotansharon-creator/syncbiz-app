/**
 * PR-C regression — PAUSE invariant for the desktop MPV freeze self-heal.
 * Pure-helper tests (no React). Run: npx tsx scripts/verify-freeze-self-heal.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { shouldFreezeSelfHeal, nextFreezeBaseline } from "../lib/desktop-freeze-self-heal";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const FREEZE_MS = 6000;

// Simulate a stream of snapshots through nextFreezeBaseline, returning the final frozenMs at `now`.
function runClock(samples: { pos: number; status: string; t: number }[], finalNow: number): { baseline: number; frozenMs: number; lastPos: number | null } {
  let baseline = 0;
  let lastPos: number | null = null;
  for (const s of samples) {
    const r = nextFreezeBaseline({ prevBaseline: baseline, prevPos: lastPos, nextPos: s.pos, snapStatus: s.status, now: s.t });
    baseline = r.baseline;
    lastPos = r.lastPos;
  }
  return { baseline, frozenMs: finalNow - baseline, lastPos };
}

// ── shouldFreezeSelfHeal ─────────────────────────────────────────────────────────────────────────────────────
assert("playing + frozen past threshold → self-heal", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: 7000, freezeMs: FREEZE_MS }) === true);
assert("playing + not yet frozen → no self-heal", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: 3000, freezeMs: FREEZE_MS }) === false);
assert("engine PAUSED (even for a huge frozenMs) → never self-heal", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "paused", frozenMs: 999_999, freezeMs: FREEZE_MS }) === false);
assert("intent PAUSED (snap still playing) → never self-heal", shouldFreezeSelfHeal({ rendererStatus: "paused", snapStatus: "playing", frozenMs: 999_999, freezeMs: FREEZE_MS }) === false);
assert("CONTROL mirror (intent not playing) → never self-heal", shouldFreezeSelfHeal({ rendererStatus: "idle", snapStatus: "playing", frozenMs: 999_999, freezeMs: FREEZE_MS }) === false);
assert("engine idle → never self-heal", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "idle", frozenMs: 999_999, freezeMs: FREEZE_MS }) === false);
assert("exactly at threshold → self-heal (>=)", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: FREEZE_MS, freezeMs: FREEZE_MS }) === true);

// ── nextFreezeBaseline: PLAYING + advancing → no freeze accrues ──────────────────────────────────────────────
{
  const r = runClock([
    { pos: 1, status: "playing", t: 1000 },
    { pos: 2, status: "playing", t: 2000 },
    { pos: 3, status: "playing", t: 3000 },
  ], 3200);
  assert("playing + advancing → frozenMs small (no freeze)", r.frozenMs < FREEZE_MS, `frozenMs=${r.frozenMs}`);
  assert("playing + advancing → shouldFreezeSelfHeal false", !shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: r.frozenMs, freezeMs: FREEZE_MS }));
}

// ── nextFreezeBaseline: PAUSED + stationary for a long time → freeze clock stays fresh ───────────────────────
{
  // position advances to 15, then PAUSED stationary for 60s of samples.
  const samples = [{ pos: 15, status: "playing", t: 1000 }];
  for (let t = 2000; t <= 61000; t += 1000) samples.push({ pos: 15, status: "paused", t });
  const r = runClock(samples, 61000);
  assert("paused + stationary 60s → frozenMs ~0 (never accrues)", r.frozenMs < 1500, `frozenMs=${r.frozenMs}`);
  assert("paused long → shouldFreezeSelfHeal false (no redispatch/skip)", !shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "paused", frozenMs: r.frozenMs, freezeMs: FREEZE_MS }));
}

// ── RESUME after a long pause → fresh baseline (not an instant freeze) ───────────────────────────────────────
{
  const samples = [{ pos: 15, status: "playing", t: 1000 }];
  for (let t = 2000; t <= 120000; t += 1000) samples.push({ pos: 15, status: "paused", t });
  // resume at t=121000: engine flips to playing, position still 15 for one tick before it advances.
  const base = runClock(samples, 121000).baseline;
  const resume = nextFreezeBaseline({ prevBaseline: base, prevPos: 15, nextPos: 15, snapStatus: "playing", now: 121000 });
  const frozenAtResume = 121000 - resume.baseline;
  assert("resume after 2min pause → baseline fresh (frozenMs ~0, not instant freeze)", frozenAtResume < 1500, `frozenMs=${frozenAtResume}`);
  assert("resume tick → shouldFreezeSelfHeal false immediately after resume", !shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: frozenAtResume, freezeMs: FREEZE_MS }));
}

// ── TRUE playing stall (playing, position NOT advancing) → still self-heals ──────────────────────────────────
{
  // advance to 15 at t=1000, then genuinely stuck at 15 while STILL reporting playing.
  const samples = [{ pos: 15, status: "playing", t: 1000 }];
  for (let t = 2000; t <= 8000; t += 1000) samples.push({ pos: 15, status: "playing", t });
  const r = runClock(samples, 8000); // baseline anchored at t=1000 (last real advance)
  assert("playing + stuck 7s → frozenMs >= FREEZE_MS", r.frozenMs >= FREEZE_MS, `frozenMs=${r.frozenMs}`);
  assert("playing + real stall → shouldFreezeSelfHeal TRUE (existing self-heal preserved)", shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: r.frozenMs, freezeMs: FREEZE_MS }));
}

// ── PAUSE → then a desync tick that flips to "playing" while still stationary ────────────────────────────────
{
  // Long pause holds the clock fresh; a single stray "playing" tick at the SAME position must not instantly fire.
  const samples = [{ pos: 15, status: "playing", t: 1000 }];
  for (let t = 2000; t <= 90000; t += 1000) samples.push({ pos: 15, status: "paused", t });
  const base = runClock(samples, 90000).baseline;
  const desync = nextFreezeBaseline({ prevBaseline: base, prevPos: 15, nextPos: 15, snapStatus: "playing", now: 90000 });
  const frozen = 90000 - desync.baseline;
  assert("pause→stray playing tick → no instant freeze (baseline was held fresh)", frozen < 1500 && !shouldFreezeSelfHeal({ rendererStatus: "playing", snapStatus: "playing", frozenMs: frozen, freezeMs: FREEZE_MS }), `frozenMs=${frozen}`);
}

// ── Static guard: the production effect uses the helper + annotated pause guards ─────────────────────────────
{
  const src = readFileSync(path.join(__dirname, "..", "components", "audio-player.tsx"), "utf-8");
  assert("audio-player imports the pure helper", /from "@\/lib\/desktop-freeze-self-heal"/.test(src));
  assert("audio-player uses shouldFreezeSelfHeal for the fire decision", /shouldFreezeSelfHeal\(\{/.test(src) && /const canSelfHeal = shouldFreezeSelfHeal/.test(src));
  assert("audio-player uses nextFreezeBaseline in applySnap (pause hold)", /nextFreezeBaseline\(\{/.test(src));
  assert("audio-player has explicit PAUSE INVARIANT guards", (src.match(/PR-C PAUSE INVARIANT/g) ?? []).length >= 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
