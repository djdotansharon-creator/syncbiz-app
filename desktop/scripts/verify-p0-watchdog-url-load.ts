/**
 * P0 (2026-10-07) — watchdog vs URL resolution + source-aware standby load windows.
 *
 * Drives the REAL watchdog code (observeProgress / deriveState / evaluatePlaybackStall / isAppHealthyFromHeartbeat
 * / killWithEscalation), the REAL MAIN attempt-id source and the REAL standby-window classifier on a simulated
 * clock. No MPV, no processes, no network.
 * Run (from desktop/): npx tsx scripts/verify-p0-watchdog-url-load.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { nextMainWsAttemptId, isMainWsAttemptId, MAIN_WS_ATTEMPT_BASE } from "../src/main/main-attempt-id";
import {
  standbyLoadTimeoutMs, isYtDlpResolvedUrl,
  STANDBY_LOAD_TIMEOUT_LOCAL_MS, STANDBY_LOAD_TIMEOUT_STREAM_MS, STANDBY_LOAD_TIMEOUT_YTDLP_MS,
} from "../src/main/mpv-input-normalize";
import { WD } from "../watchdog/contract";
import {
  initProgressTracker, observeProgress, deriveState, evaluatePlaybackStall, isAppHealthyFromHeartbeat,
  type ProgressTracker,
} from "../watchdog/state-machine";
import { killWithEscalation, type RecoveryDeps } from "../watchdog/recovery";
import type { VonoHeartbeat } from "../src/shared/vono-runtime-state";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const DESKTOP = path.join(__dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(DESKTOP, ...p), "utf-8").replace(/\r\n/g, "\n");

const PID = 4242;
function hb(now: number, pb: { status?: string; position: number; duration: number; positionAt: number; attemptId: number }, engineReady = true): VonoHeartbeat {
  return {
    schemaVersion: 1, writtenAt: now, intervalMs: 5000, pid: PID, appVersion: "test", sessionStartedAt: 0, bootId: null,
    branchId: null, deviceId: null,
    mpv: { engineReady, lastError: null },
    playback: { status: pb.status ?? "playing", position: pb.position, duration: pb.duration, positionAt: pb.positionAt, attemptId: pb.attemptId },
    renderer: { alive: null, lastSeenAt: null },
  } as unknown as VonoHeartbeat;
}
/** One watchdog tick on the simulated clock (same calls as observer.tick). */
function tick(tr: ProgressTracker, h: VonoHeartbeat, now: number) {
  const progress = observeProgress(tr, h, now);
  return deriveState({ hb: h, control: null, appProcessAlive: true, now, progress, mpvDownForMs: 0 });
}

// ── 1. fresh MAIN attempt id per WS load ──────────────────────────────────────────────────────────────────────
const a1 = nextMainWsAttemptId(), a2 = nextMainWsAttemptId(), a3 = nextMainWsAttemptId();
assert("1: consecutive WS loads get DIFFERENT, increasing attempt ids", a1 !== a2 && a2 !== a3 && a1 < a2 && a2 < a3);
assert("1: MAIN range never collides with renderer ids (renderer gen starts at 0)", a1 > MAIN_WS_ATTEMPT_BASE && isMainWsAttemptId(a1) && !isMainWsAttemptId(0) && !isMainWsAttemptId(57));
const wsm = read("src", "device-websocket-client", "device-ws-manager.ts");
const routeStart = wsm.indexOf("private routeToOrchestrator(");
const route = wsm.slice(routeStart, wsm.indexOf("\n  private ", routeStart + 10)); // the whole method
assert("1: all 6 WS-initiated loads (cold + crossfade) pass a fresh id; none use the default 0",
  (route.match(/nextMainWsAttemptId\(\)/g) ?? []).length === 6 && !/orch\.playMusic\(\w+\)/.test(route) && !/orch\.playMusicCrossfade\(\w+, fadeSec\)/.test(route));

// ── 2. each fresh attempt resets progress tracking ───────────────────────────────────────────────────────────
{
  const tr = initProgressTracker(); let t = 0;
  for (let i = 0; i < 40; i++) { t += 2000; tick(tr, hb(t, { position: i, duration: 300, positionAt: t, attemptId: a1 }), t); }
  assert("2: precondition — attempt A progressed for 80s", tr.progressObserved && tr.attemptId === a1);
  t += 2000; tick(tr, hb(t, { position: 0, duration: 0, positionAt: t, attemptId: a2 }), t);
  assert("2: new attempt B ⇒ history reset (no progress, age 0)", tr.attemptId === a2 && !tr.progressObserved && tr.attemptFirstSeenAt === t);
}

// ── 3–5. fresh URL attempt resolving at pos=0 / dur=0 ────────────────────────────────────────────────────────
function resolvingRun(seconds: number) {
  const tr = initProgressTracker(); let t = 1_000_000;
  // previous URL played (attempt a1) ...
  for (let i = 0; i < 30; i++) { t += 2000; tick(tr, hb(t, { position: i * 2, duration: 600, positionAt: t, attemptId: a1 }), t); }
  // ... then NEXT: a fresh attempt starts resolving through yt-dlp; position reset to 0 once, never advances
  const loadAt = t + 1000; const aid = nextMainWsAttemptId();
  let last = { state: "HEALTHY", reason: "" }; let firstStall: number | null = null;
  for (let s = 1; s <= seconds; s += 2) {
    const now = loadAt + s * 1000;
    last = tick(tr, hb(now, { position: 0, duration: 0, positionAt: loadAt, attemptId: aid }), now);
    if (last.state === "PLAYBACK_STALLED" && firstStall === null) firstStall = s;
  }
  return { last, firstStall };
}
const r20 = resolvingRun(20), r70 = resolvingRun(70), r130 = resolvingRun(130);
assert("3: fresh URL attempt, pos=0/dur=0 for 20s ⇒ NOT PLAYBACK_STALLED", r20.firstStall === null && r20.last.state === "HEALTHY");
assert("4: fresh URL attempt, no progress at 70s ⇒ NOT PLAYBACK_STALLED", r70.firstStall === null && r70.last.state === "HEALTHY");
assert("5: no progress beyond 120s ⇒ bounded startup-stuck (PLAYBACK_STALLED, startup hard max)",
  r130.firstStall !== null && r130.firstStall > WD.startupHardMaxMs / 1000 && /startup hard max/.test(r130.last.reason), `first stall at ${r130.firstStall}s`);
assert("5: hard max value = 120s", WD.startupHardMaxMs === 120_000);
// regression proof of the root cause: the SAME id reused (old behavior, attempt 0) WOULD stall at ~12s
{
  const tr = initProgressTracker(); let t = 0;
  for (let i = 0; i < 30; i++) { t += 2000; tick(tr, hb(t, { position: i * 2, duration: 600, positionAt: t, attemptId: 0 }), t); }
  const loadAt = t + 1000; let stallAt: number | null = null;
  for (let s = 1; s <= 30 && stallAt === null; s += 1) { const now = loadAt + s * 1000; if (tick(tr, hb(now, { position: 0, duration: 0, positionAt: loadAt, attemptId: 0 }), now).state === "PLAYBACK_STALLED") stallAt = s; }
  assert("root cause reproduced: a REUSED attempt id (old WS default 0) is called stalled ~12s into a resolve", stallAt !== null && stallAt <= 14, `at ${stallAt}s`);
}

// ── 6. real freeze AFTER playback progress still stalls ──────────────────────────────────────────────────────
{
  const tr = initProgressTracker(); let t = 5_000_000; const aid = nextMainWsAttemptId();
  for (let i = 0; i < 20; i++) { t += 2000; tick(tr, hb(t, { position: i * 2, duration: 600, positionAt: t, attemptId: aid }), t); }
  const frozenAt = t; let r = { state: "", reason: "" }; let stallAt: number | null = null;
  for (let s = 2; s <= 20; s += 2) { const now = frozenAt + s * 1000; r = tick(tr, hb(now, { position: 38, duration: 600, positionAt: frozenAt, attemptId: aid }), now); if (r.state === "PLAYBACK_STALLED" && stallAt === null) stallAt = s; }
  assert("6: progress then freeze > 12s ⇒ PLAYBACK_STALLED (existing mid-playback rule)", stallAt !== null && stallAt > 12 && stallAt <= 14 && /no progress/.test(r.reason), `at ${stallAt}s`);
}
// paused / idle never stalls
{
  const tr = initProgressTracker(); const v = evaluatePlaybackStall(hb(1e6, { status: "paused", position: 0, duration: 0, positionAt: 0, attemptId: 7 }), observeProgress(tr, hb(1e6, { status: "paused", position: 0, duration: 0, positionAt: 0, attemptId: 7 }), 1e6 + 9e5), 1e6 + 9e5);
  assert("not intending to play (paused) ⇒ never stalled", !v.stalled);
}

// ── 7. recovery kill cancellation on the SAME predicate ──────────────────────────────────────────────────────
async function killScenario(during: "fresh_attempt" | "progress_resumes" | "still_frozen") {
  const tr = initProgressTracker(); let clock = 9_000_000; const aid = nextMainWsAttemptId();
  for (let i = 0; i < 20; i++) { clock += 2000; observeProgress(tr, hb(clock, { position: i * 2, duration: 600, positionAt: clock, attemptId: aid }), clock); }
  const frozenAt = clock; clock += 15_000; // frozen > 12s ⇒ recovery decided
  let current = hb(clock, { position: 38, duration: 600, positionAt: frozenAt, attemptId: aid });
  const kills: string[] = []; let alive = true;
  const deps: RecoveryDeps = {
    isValidExe: () => true, launch: () => true,
    killTree: (pid, force) => { kills.push(force ? "force" : "graceful"); if (force) alive = false; return true; },
    isAlive: () => alive, isVonoPid: () => alive,
    isAppHealthy: (pid) => isAppHealthyFromHeartbeat(current, pid, tr, clock),
    sleep: async (ms) => {
      clock += ms;
      if (during === "fresh_attempt" && clock - frozenAt > 16_000) current = hb(clock, { position: 0, duration: 0, positionAt: clock, attemptId: nextMainWsAttemptId() });
      else if (during === "progress_resumes" && clock - frozenAt > 16_000) current = hb(clock, { position: 40, duration: 600, positionAt: clock, attemptId: aid });
      else current = hb(clock, { ...current.playback, status: "playing" } as never);
    },
    now: () => clock, log: () => {},
  };
  const outcome = await killWithEscalation(PID, deps);
  return { outcome, kills };
}

(async () => {
  const k1 = await killScenario("fresh_attempt");
  assert("7: recovery started, then a FRESH attempt appears ⇒ aborted_healthy, NO force kill", k1.outcome === "aborted_healthy" && !k1.kills.includes("force"), JSON.stringify(k1));
  const k2 = await killScenario("progress_resumes");
  assert("7: recovery started, then progress resumes ⇒ aborted_healthy, NO force kill", k2.outcome === "aborted_healthy" && !k2.kills.includes("force"), JSON.stringify(k2));
  const k3 = await killScenario("still_frozen");
  assert("7: still frozen ⇒ graceful then force (real freeze still recovered)", k3.kills.join(",") === "graceful,force" && k3.outcome === "dead", JSON.stringify(k3));
  const obs = read("watchdog", "observer.ts");
  assert("7: observer isAppHealthy uses the SHARED predicate with the live tracker (old crude rule gone)",
    /isAppHealthyFromHeartbeat\(readJson<VonoHeartbeat>\(heartbeatPath\(\)\), pid, liveProgressTracker \?\? initProgressTracker\(\), Date\.now\(\)\)/.test(obs) &&
    /liveProgressTracker = tracker;/.test(obs) && !/hb\.playback\.status === "playing" && now - hb\.playback\.positionAt > WD\.playbackStallMs\) return false/.test(obs));
  const sm = read("watchdog", "state-machine.ts");
  assert("deriveState uses evaluatePlaybackStall (single predicate)", /const verdict = evaluatePlaybackStall\(hb, input\.progress, now\);/.test(sm));

  // ── 8–11. source-aware standby windows ─────────────────────────────────────────────────────────────────────
  const yt = "https://www.youtube.com/watch?v=tgos9sjhj-I";
  assert("YouTube family / SoundCloud / ytdl:// are yt-dlp sources", ["https://youtu.be/x", "https://music.youtube.com/watch?v=x", "https://m.youtube.com/watch?v=x", yt, "https://soundcloud.com/a/b", "ytdl://x"].every(isYtDlpResolvedUrl));
  assert("plain stream / local are NOT yt-dlp sources", !isYtDlpResolvedUrl("https://stream.example.com/live.mp3") && !isYtDlpResolvedUrl("D:\\Music\\a.mp3") && !isYtDlpResolvedUrl("https://notyoutube.com/watch?v=x"));
  const ytWin = standbyLoadTimeoutMs(yt);
  assert("8: YouTube standby resolving for 70s ⇒ NOT timed out (window 90s)", ytWin === 90_000 && 70_000 < ytWin && STANDBY_LOAD_TIMEOUT_YTDLP_MS === 90_000);
  assert("9: YouTube standby beyond 90s ⇒ times out", 91_000 > ytWin);
  assert("10: plain stream URL still 30s", standbyLoadTimeoutMs("https://stream.example.com/live.mp3") === 30_000 && STANDBY_LOAD_TIMEOUT_STREAM_MS === 30_000);
  assert("11: LOCAL standby still 12s", standbyLoadTimeoutMs("D:\\Music\\a.mp3") === 12_000 && standbyLoadTimeoutMs("file:///D:/Music/a.mp3") === 12_000 && STANDBY_LOAD_TIMEOUT_LOCAL_MS === 12_000);
  const orch = read("src", "main", "playback-orchestrator.ts");
  const xf = orch.slice(orch.indexOf("playMusicCrossfade(url: string"), orch.indexOf("private beginXfadeRamp"));
  assert("9: on timeout the standby aborts cleanly via abortXfade('standby_load_timeout') — active deck untouched, no restart",
    /const loadTimeoutMs = standbyLoadTimeoutMs\(u\);/.test(xf) && /this\.abortXfade\("standby_load_timeout"\);/.test(xf) && !/process\.exit|app\.(quit|relaunch)|killTree/.test(xf));
  assert("old flat URL 30s constant removed", !/XFADE_LOAD_TIMEOUT_URL_MS/.test(orch));

  console.log(`\n${pass} passed, ${fail} failed`);
})();
