/**
 * P0 — LOCAL startup-stall backstop must NEVER destroy the playback session.
 *
 * Proven bug: 4s without a "playing" confirmation for a LOCAL file → stop() → currentSource/playlist/queueIndex
 * cleared → deck empty → recovery snapshot erased → permanently stopped (even when MPV was merely slow, e.g.
 * loadfile→start-file 4.1s under machine load).
 *
 * Coverage:
 *  - PURE: decideLocalStartupStall (lib/desktop-freeze-self-heal.ts) — every branch.
 *  - MODEL: a deterministic replay of the renderer's startup/stall/freeze state machine (same constants and
 *    transitions as components/audio-player.tsx, driven by the real decision helper) for the field timeline.
 *  - STATIC: guards on the real audio-player.tsx source proving no path from the stall backstop to stop() /
 *    session clear, and that the existing load_error / startup / freeze / skip paths are intact.
 *
 * Run: npx tsx scripts/verify-local-startup-stall.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { decideLocalStartupStall } from "../lib/desktop-freeze-self-heal";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const src = readFileSync(path.join(__dirname, "..", "components", "audio-player.tsx"), "utf-8").replace(/\r\n/g, "\n");
const LOCAL = "C:\\Music\\a.mp3";
const base = { attemptId: 8, currentAttemptId: 8, rendererStatus: "playing", armedUrl: LOCAL, currentUrl: LOCAL, engineStatus: "idle", snap: null as null | { attemptId?: number; lastError?: string | null; attemptMode?: string | null } };

// ── PURE decision ────────────────────────────────────────────────────────────────────────────────────────────
assert("#1 slow LOCAL start (no confirmation at 4s, MPV alive) → enter_startup_recovery (NOT stop)",
  decideLocalStartupStall({ ...base, snap: { attemptId: 8, lastError: null, attemptMode: "cold" } }) === "enter_startup_recovery");
assert("#1 no snapshot for this attempt yet (very slow MPV) → enter_startup_recovery",
  decideLocalStartupStall({ ...base, snap: { attemptId: 7, lastError: null } }) === "enter_startup_recovery");
assert("MPV temporarily unavailable (engineReady false, no error) → enter_startup_recovery (never stop)",
  decideLocalStartupStall({ ...base, engineStatus: null, snap: null }) === "enter_startup_recovery");
assert("#3 genuine load error for THIS attempt → defer_load_error (existing skip path owns it)",
  decideLocalStartupStall({ ...base, snap: { attemptId: 8, lastError: "Failed to open file" } }) === "defer_load_error");
assert("load error of an OLDER attempt does not count for this one",
  decideLocalStartupStall({ ...base, snap: { attemptId: 7, lastError: "old error" } }) === "enter_startup_recovery");
assert("#4 crossfade-mode attempt → defer_crossfade (orchestrator owns startup timeout)",
  decideLocalStartupStall({ ...base, snap: { attemptId: 8, attemptMode: "crossfade" } }) === "defer_crossfade");
assert("confirmed playing within 4s → ignore", decideLocalStartupStall({ ...base, engineStatus: "playing" }) === "ignore");
assert("superseded attempt → ignore", decideLocalStartupStall({ ...base, currentAttemptId: 9 }) === "ignore");
assert("paused/stopped intent → ignore", decideLocalStartupStall({ ...base, rendererStatus: "paused" }) === "ignore"
  && decideLocalStartupStall({ ...base, rendererStatus: "stopped" }) === "ignore");
assert("track changed → ignore", decideLocalStartupStall({ ...base, currentUrl: "C:\\Music\\b.mp3" }) === "ignore");
assert("decision space has NO stop/clear outcome",
  ["ignore", "defer_load_error", "defer_crossfade", "enter_startup_recovery"].every((d) => !/stop|clear/i.test(d)));

// ── MODEL: deterministic replay of the renderer state machine (constants mirrored from audio-player.tsx) ───
const STREAM_STARTUP_TIMEOUT_MS = Number(/const STREAM_STARTUP_TIMEOUT_MS = (\d+);/.exec(src)?.[1]);
const STREAM_STARTUP_MAX_RETRIES = Number(/const STREAM_STARTUP_MAX_RETRIES = (\d+);/.exec(src)?.[1]);
const STREAM_MIN_PROGRESS_ADVANCES = Number(/const STREAM_MIN_PROGRESS_ADVANCES = (\d+);/.exec(src)?.[1]);
assert("constants extracted from the real source", STREAM_STARTUP_TIMEOUT_MS === 30000 && STREAM_STARTUP_MAX_RETRIES === 1 && STREAM_MIN_PROGRESS_ADVANCES === 2);

type Snap = { t: number; attemptId: number; status: string; position: number; lastError?: string | null };
function simulate(opts: { snaps: (dispatchAttemptIds: number[]) => Snap[]; untilMs: number; queueLen?: number }) {
  const s = {
    status: "playing", currentSourceSet: true, queueIndex: 0, recoverySnapshot: true, trackIndex: 0,
    gen: 8, phase: "playing" as "playing" | "starting", confirmed: false, progress: 0,
    attemptStartAt: 0, startupItem: null as string | null, retries: 0, lastPos: null as number | null,
    engine: "idle", stops: 0, nexts: 0, dispatches: [8] as number[],
  };
  const url = () => `C:\\Music\\t${s.trackIndex}.mp3`;
  const stop = () => { s.stops++; s.status = "stopped"; s.currentSourceSet = false; s.queueIndex = -1; s.recoverySnapshot = false; };
  const next = () => { s.nexts++; s.trackIndex++; s.gen++; s.dispatches.push(s.gen); s.phase = "playing"; s.confirmed = false; s.progress = 0; s.attemptStartAt = tNow; s.startupItem = null; s.retries = 0; s.lastPos = null; stallArmedAt = tNow; stallFor = { gen: s.gen, url: url() }; };
  let tNow = 0;
  let stallArmedAt: number | null = 0;
  let stallFor = { gen: s.gen, url: url() };
  const snaps = opts.snaps(s.dispatches).sort((a, b) => a.t - b.t);
  let si = 0;
  for (tNow = 0; tNow <= opts.untilMs; tNow += 100) {
    while (si < snaps.length && snaps[si].t <= tNow) {
      const sn = snaps[si++];
      s.engine = sn.status;
      if (sn.attemptId !== s.gen) continue;
      if (sn.status === "idle" && sn.lastError && s.status === "playing") { next(); continue; } // load_error → skip once
      if (sn.status === "playing" && sn.position > 0) s.confirmed = true;
      const posChanged = s.lastPos === null || sn.position !== s.lastPos;
      if (s.phase === "starting" && posChanged && sn.position > 0 && sn.status === "playing") {
        s.progress++; if (s.progress >= STREAM_MIN_PROGRESS_ADVANCES) { s.phase = "playing"; s.startupItem = null; s.retries = 0; }
      }
      s.lastPos = sn.position;
    }
    if (stallArmedAt !== null && tNow - stallArmedAt >= 4000) {
      stallArmedAt = null;
      const d = decideLocalStartupStall({ attemptId: stallFor.gen, currentAttemptId: s.gen, rendererStatus: s.status, armedUrl: stallFor.url, currentUrl: s.status === "playing" ? url() : null, engineStatus: s.engine, snap: null });
      if (d === "enter_startup_recovery") { s.startupItem = url(); s.phase = "starting"; } // NEW behavior (OLD: stop())
    }
    if (tNow % 1000 === 0 && s.status === "playing" && s.phase === "starting" && tNow - s.attemptStartAt >= STREAM_STARTUP_TIMEOUT_MS) {
      if (s.retries < STREAM_STARTUP_MAX_RETRIES) { s.retries++; s.gen++; s.dispatches.push(s.gen); s.attemptStartAt = tNow; s.progress = 0; s.lastPos = null; s.phase = "starting"; }
      else { s.startupItem = null; s.retries = 0; s.phase = "playing"; next(); }
    }
  }
  return { ...s, stop };
}

{ // #1/#2 field timeline: STARTFILE at 4.1s, then normal progress
  const r = simulate({ untilMs: 20000, snaps: () => [
    { t: 4100, attemptId: 8, status: "playing", position: 0 },
    ...Array.from({ length: 15 }, (_, i) => ({ t: 4600 + i * 500, attemptId: 8, status: "playing", position: 0.5 * (i + 1) })),
  ] });
  assert("#1 STARTFILE at 4.1s → session preserved (no stop, source+queue intact)", r.stops === 0 && r.currentSourceSet && r.queueIndex === 0);
  assert("#2 late confirmation recovers normally (confirmed, phase back to playing, no skip)", r.confirmed && r.phase === "playing" && r.nexts === 0);
  assert("#6 recovery snapshot NOT cleared by the startup delay", r.recoverySnapshot === true && r.status === "playing");
}
{ // #3 genuine load error at 1s → existing skip path, session kept
  const r = simulate({ untilMs: 3000, snaps: () => [{ t: 1000, attemptId: 8, status: "idle", position: 0, lastError: "Failed to open" }] });
  assert("#3 genuine load error → SKIP_FORWARD once (next), session preserved", r.nexts === 1 && r.stops === 0 && r.currentSourceSet);
}
{ // #5 MPV never answers → bounded: 30s grace → 1 retry → 30s → SKIP_FORWARD; never stop
  const r = simulate({ untilMs: 61000, snaps: () => [] });
  assert("#5 startup recovery exhaustion → exactly one retry then fail-forward (next)", r.dispatches.length === 3 && r.nexts === 1, JSON.stringify({ d: r.dispatches, n: r.nexts }));
  assert("#5 exhaustion never stops the player / clears the session", r.stops === 0 && r.status === "playing" && r.currentSourceSet && r.recoverySnapshot);
}
{ // late confirmation during the RETRY window still recovers
  const r = simulate({ untilMs: 45000, snaps: (d) => [
    ...Array.from({ length: 10 }, (_, i) => ({ t: 34000 + i * 500, attemptId: 9, status: "playing", position: 0.5 * (i + 1) })),
  ] });
  void r;
  assert("retry attempt confirming late → back to playing, no skip, no stop", r.phase === "playing" && r.nexts === 0 && r.stops === 0);
}

// ── STATIC guards on the real source ────────────────────────────────────────────────────────────────────────
const sStart = src.indexOf("// Stall backstop — LOCAL FILES ONLY.");
const stallBlock = src.slice(sStart, src.indexOf("}, 4000);", sStart));
assert("stall backstop found", sStart > 0 && stallBlock.length > 200);
const stallCode = stallBlock.replace(/\/\/[^\n]*/g, "");
assert("ABSOLUTE: stall backstop has NO stop() call", !/\bstop\(\)/.test(stallCode));
assert("ABSOLUTE: stall backstop never clears source/playlist/queue/recovery",
  !/currentSource\s*[:=]\s*null|currentPlaylist\s*[:=]\s*null|queueIndex\s*[:=]\s*-1|clearPersistedPlaybackV2|setLastMessage/.test(stallCode));
assert("stall backstop uses the pure decision helper", /decideLocalStartupStall\(\{/.test(stallCode));
assert("enter_startup_recovery hands to the EXISTING startup machine (same item, phase starting)",
  /if \(decision !== "enter_startup_recovery"\) return;/.test(stallCode) && /streamStartupItemRef\.current = latest;/.test(stallCode) && /streamPhaseRef\.current = "starting";/.test(stallCode));
const startupAnchor = src.indexOf("// ── STREAM_STARTING — bounded startup timeout");
const startup = src.slice(src.indexOf('if (streamPhaseRef.current === "starting") {', startupAnchor), src.indexOf("// ── STREAM_PLAYING (or local file)"));
assert("startup-machine slice anchored to the bounded-startup section", startupAnchor > 0 && startup.length > 500 && startup.length < 6000);
assert("#4 startup machine still defers crossfade attempts to the orchestrator (unchanged)",
  /modeSnap\.attemptMode === "crossfade"\) return;/.test(startup));
assert("retry keeps the attempt STARTING for any source (bounded LOCAL retry)",
  /resetStreamAttempt\(url\);[^\n]*\n\s*streamPhaseRef\.current = "starting";/.test(startup));
assert("#5 exhaustion → nextRef ended_auto, no stop() in the startup machine",
  /nextRef\.current\?\.\(\{ auditTransportCase: "ended_auto" \}\);/.test(startup) && !/\bstop\(\)/.test(startup.replace(/\/\/[^\n]*/g, "")));
assert("#2 progress detection exits STARTING for any source type (late confirmation recovers)",
  /streamPhaseRef\.current === "starting" &&\s*posChanged &&\s*nextPos > 0 &&/.test(src) && /streamPhaseRef\.current = "playing";\s*\n\s*desktopSnapPositionAtRef\.current = Date\.now\(\);/.test(src));
assert("#3 load_error → SKIP_FORWARD path unchanged",
  /if \(isCurrentAttempt && intendPlaying && next === "idle" && snap\?\.lastError && snap\.engineReady !== false\) \{/.test(src) &&
  /sbDiag\("SKIP_FORWARD", \{ reason: "load_error"/.test(src));
assert("#7 freeze self-heal still bounded (MAX_REDISPATCH = 3, FREEZE_MS = 6000, skip once per url)",
  /const MAX_REDISPATCH = 3;/.test(src) && /const FREEZE_MS = 6000;/.test(src) && /if \(mpvFrozenSkippedForUrlRef\.current !== url\) \{/.test(src));
assert("freeze self-heal does not call stop()", (() => {
  const f = src.slice(src.indexOf("// ── Desktop MPV self-heal"), src.indexOf("READ-ONLY diagnostic for the rare"));
  return f.length > 500 && !/\bstop\(\)/.test(f.replace(/\/\/[^\n]*/g, ""));
})());

console.log(`\n${pass} passed, ${fail} failed`);
