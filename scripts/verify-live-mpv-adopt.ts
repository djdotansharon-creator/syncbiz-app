/**
 * Deterministic regression for live-MPV adoption on renderer remount (lib/live-mpv-adopt.ts).
 *
 * Incident: a URL was playing via the MAIN-process MPV; the renderer (app) tree remounted; the new
 * renderer must RE-OWN the running engine (suppress the initial loadfile, align the attempt id) instead
 * of restarting or orphaning it. `shouldAdoptLiveMpv` is the fail-safe decision: true ONLY on the first
 * dispatch after mount when the desktop reports a healthy PLAYING engine with a real attempt id + a URL.
 *
 * Run: npx tsx scripts/verify-live-mpv-adopt.ts
 */
import { shouldAdoptLiveMpv } from "@/lib/live-mpv-adopt";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const URL = "https://www.youtube.com/watch?v=abc123";
const livePlaying = { engineReady: true, status: "playing", attemptId: 6 };

// ── ADOPT: renderer remount while a healthy engine is actively playing ────────────────────────────
assert("adopt: first dispatch + engine playing + attemptId>0 + url → TRUE (re-own live MPV)",
  shouldAdoptLiveMpv(true, URL, livePlaying) === true);

// ── DO NOT ADOPT: normal non-remount playback (not the first dispatch) ─────────────────────────────
assert("no-adopt: not first dispatch → FALSE (normal playback unchanged, no duplicate dispatch)",
  shouldAdoptLiveMpv(false, URL, livePlaying) === false);

// ── DO NOT ADOPT: intentional STOP (engine idle) ──────────────────────────────────────────────────
assert("no-adopt: engine idle → FALSE (STOP stays stopped)",
  shouldAdoptLiveMpv(true, URL, { engineReady: true, status: "idle", attemptId: 6 }) === false);
assert("no-adopt: engine stopped → FALSE",
  shouldAdoptLiveMpv(true, URL, { engineReady: true, status: "stopped", attemptId: 6 }) === false);

// ── DO NOT ADOPT: PAUSED (engine paused) ──────────────────────────────────────────────────────────
assert("no-adopt: engine paused → FALSE (paused not auto-resumed)",
  shouldAdoptLiveMpv(true, URL, { engineReady: true, status: "paused", attemptId: 6 }) === false);

// ── DO NOT ADOPT: stale / missing attempt id ──────────────────────────────────────────────────────
assert("no-adopt: attemptId 0 → FALSE (stale attempt not adopted)",
  shouldAdoptLiveMpv(true, URL, { engineReady: true, status: "playing", attemptId: 0 }) === false);
assert("no-adopt: attemptId missing → FALSE",
  shouldAdoptLiveMpv(true, URL, { engineReady: true, status: "playing", attemptId: undefined }) === false);

// ── DO NOT ADOPT: engine not ready, no snapshot, no URL (fail-safe → normal loadfile) ──────────────
assert("no-adopt: engineReady false → FALSE (don't suppress a load on an unconfirmed engine)",
  shouldAdoptLiveMpv(true, URL, { engineReady: false, status: "playing", attemptId: 6 }) === false);
assert("no-adopt: null snapshot → FALSE", shouldAdoptLiveMpv(true, URL, null) === false);
assert("no-adopt: no currentPlayUrl → FALSE", shouldAdoptLiveMpv(true, "", livePlaying) === false && shouldAdoptLiveMpv(true, null, livePlaying) === false);

// ── local file playing live is also adoptable (same re-ownership need) ─────────────────────────────
assert("adopt: local file + live playing engine → TRUE",
  shouldAdoptLiveMpv(true, "C:\\Music\\a.mp3", livePlaying) === true);

console.log(`\n${pass} passed, ${fail} failed`);
