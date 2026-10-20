/**
 * P0 Gate 2a item 3 (2026-10-08) — FAILED STANDBY must never cause MAIN to lose visibility of the deck that is still
 * audibly playing (Oct 7 Lenovo: URL standby failed at 20:08:43 over LOCAL; the LOCAL track ended at 20:09:58 unseen →
 * 58 min silence).
 *  MAIN (orchestrator, REPORTING ONLY): a MAIN-started standby failure is reported ONCE under the failed id, then the
 *  reported current attempt returns to the audible deck (id / url / mode) — its status / position / natural end stay
 *  observable. Renderer-started (LOCAL) standbys, benign aborts and silent (cold) cases are unchanged.
 *  Renderer: on "current music kept" / "not sent" the session in force before the transition is handed back.
 * REAL PlaybackOrchestrator + DeviceWsManager (synthetic MPV events) + REAL pure functions; static pins at the end.
 * Run (from desktop/): npx tsx scripts/verify-gate2a-failed-standby-visibility.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager } from "../src/device-websocket-client/device-ws-manager";
import { initialUrlEofState, observeUrlEof } from "../../lib/url-eof-advance";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; stop: () => void; setVolume: (v: number) => void; play: (u: string, id?: number) => void; pause: () => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; currentAttemptDeck: "A" | "B"; activeMusicDeck: "A" | "B"; musicStA: { status: string }; musicStB: { status: string }; abortXfade: (r: string) => void };
type Music = { attemptId: number; status: string; lastError: string | null; position: number; duration: number };
const LOCAL = "C:\\music\\one.mp3";
const urlOf = (i: number) => `https://www.youtube.com/watch?v=vis${String(i).padStart(8, "0")}`;
const payload = (i: number) => ({ source: { id: `pl:track:r${i}`, title: `T${i}`, url: urlOf(i), type: "youtube", origin: "playlist", playlistId: "pl", sessionTracks: [0, 1, 2, 3].map((k) => ({ id: `t${k}`, title: `T${k}`, cover: null, url: urlOf(k) })) }, trackIndex: i });

function world() {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const calls: string[] = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    const st = d.stop.bind(d), sv = d.setVolume.bind(d), pl = d.play.bind(d), pa = d.pause.bind(d);
    d.stop = () => { calls.push(`${id}:stop`); st(); };
    d.setVolume = (v) => { calls.push(`${id}:vol=${v}`); sv(v); };
    d.play = (u, a) => { calls.push(`${id}:play`); pl(u, a); };
    d.pause = () => { calls.push(`${id}:pause`); pa(); };
  }
  const reports: Music[] = [];
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  orch.onStatus((s: { music: Music }) => reports.push({ ...s.music })); // NOTE: replaces mgr's listener only for the raw stream below
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void };
  const toMain = (cmd: string, p?: unknown) => m.runTransportCommand(cmd, p, "ws");
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const cur = () => deck(o.currentAttemptDeck);
  const active = () => deck(o.activeMusicDeck);
  const playing = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 200 }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); d.handleEvent({ event: "property-change", name: "time-pos", data: 1 }); d.handleEvent({ event: "property-change", name: "time-pos", data: 2 }); };
  const failAtZero = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 225 }); d.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" }); };
  const naturalEnd = (d: Deck) => { d.handleEvent({ event: "property-change", name: "time-pos", data: 199 }); d.handleEvent({ event: "end-file", reason: "eof" }); };
  const state = () => orch.getState().music as unknown as Music;
  const audibleStatus = () => (o.activeMusicDeck === "A" ? o.musicStA : o.musicStB).status;
  return { orch, o, calls, reports, toMain, cur, active, playing, failAtZero, naturalEnd, state, audibleStatus };
}

// ── 1. LOCAL audible (renderer attempt 7) → MAIN URL standby fails ──
{
  const w = world();
  w.orch.playMusic(LOCAL, 7); w.playing(w.active());
  w.toMain("PLAY_SOURCE", payload(1));
  const failedId = w.state().attemptId;
  const mark = w.reports.length; const callMark = w.calls.length;
  w.failAtZero(w.cur());
  const after = w.reports.slice(mark);
  const failedReports = after.filter((r) => r.attemptId === failedId && r.status === "idle" && !!r.lastError);
  assert("M1 failure reported ONCE under the failed attempt id (idle + error)", failedReports.length === 1, `failed=${failedReports.length}`);
  const lastR = after[after.length - 1];
  assert("M2 then MAIN reports the ACTUAL audible deck again (attempt 7, playing, no error)", lastR?.attemptId === 7 && lastR.status === "playing" && !lastR.lastError && w.state().attemptId === 7, JSON.stringify(lastR));
  assert("M3 audible deck untouched (never stopped / paused / re-volumed below target)", w.audibleStatus() === "playing" && !w.calls.slice(callMark).some((c) => c === `${w.o.activeMusicDeck}:stop` || c === `${w.o.activeMusicDeck}:pause`));
  assert("M4 not pending after the restore (PLAY / selections are not blocked by a dead attempt)", w.orch.isMusicAttemptPending() === false);
  w.naturalEnd(w.active());
  assert("M5 the audible LOCAL track's NATURAL END is observable (attempt 7 → idle, no error)", w.state().attemptId === 7 && w.state().status === "idle" && !w.state().lastError);
  w.orch.kill();
}
// ── 2. URL audible (MAIN attempt A) → standby X fails → A's natural end drives the URL EOF step ──
{
  const w = world();
  w.toMain("PLAY_SOURCE", payload(0)); w.playing(w.cur());
  const a = w.state().attemptId;
  let eof = initialUrlEofState();
  const feed = () => { const s = w.state(); const r = observeUrlEof(eof, { status: s.status, attemptId: s.attemptId, position: s.position, duration: s.duration, lastError: s.lastError, engineReady: true }, true); eof = r.state; return r.advance; };
  feed();
  w.toMain("PLAY_SOURCE", payload(3)); feed();
  w.failAtZero(w.cur()); feed();
  assert("U1 after the failed standby MAIN reports the audible URL attempt A again", w.state().attemptId === a && w.state().status === "playing");
  feed(); // re-arm on A
  w.naturalEnd(w.active());
  const adv = feed();
  assert("U2 A's natural end is observed → the URL EOF step fires exactly for A (no silence)", adv === true && w.state().attemptId === a);
  w.orch.kill();
}
// ── 3. newest-wins (X then Y while pending), Y fails → original audible identity ──
{
  const w = world();
  w.orch.playMusic(LOCAL, 9); w.playing(w.active());
  w.toMain("PLAY_SOURCE", payload(1));
  w.toMain("PLAY_SOURCE", payload(2));
  w.failAtZero(w.cur());
  assert("N1 X then Y (newest wins), Y fails → MAIN reports the ORIGINAL audible attempt 9", w.state().attemptId === 9 && w.state().status === "playing");
  w.orch.kill();
}
// ── 4. load-timeout failure path ──
{
  const w = world();
  w.orch.playMusic(LOCAL, 11); w.playing(w.active());
  w.toMain("PLAY_SOURCE", payload(1));
  w.o.abortXfade("standby_load_timeout");
  assert("T1 standby LOAD TIMEOUT → failure reported, then the audible attempt 11 restored", w.reports.some((r) => r.lastError && r.attemptId > 1e9) && w.state().attemptId === 11 && w.state().status === "playing");
  w.orch.kill();
}
// ── 5. UNCHANGED cases ──
{
  const w = world();
  w.orch.playMusic(LOCAL, 7); w.playing(w.active());
  w.orch.playMusicCrossfade("C:\\music\\two.mp3", 6, 8); // renderer-started LOCAL standby
  w.failAtZero(w.cur());
  assert("X1 renderer-started (LOCAL) standby failure → UNCHANGED: reported as attempt 8 failed (renderer skip path)", w.state().attemptId === 8 && w.state().status === "idle" && !!w.state().lastError);
  w.orch.kill();
  const w2 = world();
  w2.orch.playMusic(LOCAL, 7); w2.playing(w2.active());
  w2.toMain("PLAY_SOURCE", payload(1)); const pid = w2.state().attemptId;
  w2.toMain("PAUSE");
  assert("X2 benign abort (PAUSE during pending) → UNCHANGED (no failure, no identity change)", w2.state().attemptId === pid && !w2.state().lastError);
  w2.orch.kill();
  const w3 = world();
  w3.toMain("PLAY_SOURCE", payload(1)); const cid = w3.state().attemptId;
  w3.failAtZero(w3.cur());
  assert("X3 nothing audible (cold) failure → UNCHANGED (failed attempt stays reported; nothing to restore)", w3.state().attemptId === cid && w3.state().status === "idle" && !!w3.state().lastError);
  w3.orch.kill();
}

// ── 6. renderer hand-back (mirror of lib/device-player-context.tsx setUrlTransition / beginUrlTransition) ──
{
  type Pre = { localOwned: boolean; sentLeaf: string | null } | null;
  const refs = { localOwned: true, sentLeaf: null as string | null, pre: null as Pre, phase: null as string | null };
  const begin = () => { if (refs.phase !== "loading" && refs.phase !== "trying-next" && refs.phase !== "failed-kept") refs.pre = { localOwned: refs.localOwned, sentLeaf: refs.sentLeaf }; refs.phase = "loading"; };
  const setPhase = (ph: string | null) => {
    if (refs.pre && ph && (ph === "failed-kept" || ph === "not-sent")) { refs.localOwned = refs.pre.localOwned; refs.sentLeaf = refs.pre.sentLeaf; }
    if (ph !== "loading" && ph !== "trying-next") refs.pre = null;
    refs.phase = ph;
  };
  // LOCAL playing → URL select (begin BEFORE relinquish, as in playSourceOrSend) → fails, nothing left → kept
  begin(); refs.localOwned = false; refs.sentLeaf = "pl:track:r3";
  setPhase("failed-kept");
  assert("R1 LOCAL session handed back after 'current music kept' (LOCAL engine continues at its natural end)", refs.localOwned === true && refs.sentLeaf === null);
  // URL A playing → select X (fails, 1b steps X+1 inside the hold, also fails, exhausted) → baseline back to A
  refs.localOwned = false; refs.sentLeaf = "pl:track:r0"; refs.phase = "confirmed";
  begin(); refs.sentLeaf = "pl:track:r2"; refs.phase = "trying-next"; begin(); refs.sentLeaf = "pl:track:r3";
  setPhase("failed-kept");
  assert("R2 URL baseline handed back to the AUDIBLE item A (not the failed X / X+1)", refs.sentLeaf === "pl:track:r0" && refs.localOwned === false);
  begin(); refs.sentLeaf = "pl:track:r1"; setPhase("confirmed");
  assert("R3 confirmed new item → NO hand-back (the new session stands)", refs.sentLeaf === "pl:track:r1" && refs.pre === null);
}

// ── static pins ──
const rd = (p: string) => readFileSync(path.join(__dirname, "..", "..", p), "utf-8").replace(/\r\n/g, "\n");
const orchSrc = rd("desktop/src/main/playback-orchestrator.ts");
const dpc = rd("lib/device-player-context.tsx");
const restoreFn = orchSrc.slice(orchSrc.indexOf("private restoreAudibleAfterFailedStandby"), orchSrc.indexOf("private clearXfadeTimers"));
assert("S1 orchestrator restore is REPORTING ONLY (no deck / MPV / volume / timer / play / stop calls)",
  restoreFn.length > 0 && !/\.(stop|play|pause|setVolume|loadfile)\(|setTimeout|setInterval|clearXfadeTimers|Mpv\(\)/.test(restoreFn));
assert("S2 restore only for MAIN-started attempts after a FAILURE reason, with the active deck still audible",
  /if \(reason !== "standby_decode_failed" && reason !== "standby_load_timeout"\) return;/.test(restoreFn) && /isMainWsAttemptId\(this\.currentAttemptId\)/.test(restoreFn) && /active\.attemptId !== prev\.id/.test(restoreFn));
assert("S3 the failure is pushed BEFORE the restore (reported once)", /this\.push\(\); \/\/ the failure is reported ONCE[^\n]*\n\s+this\.restoreAudibleAfterFailedStandby\(reason\);/.test(orchSrc));
assert("S4 renderer: capture at transition start; hand-back on failed-kept / not-sent; steps begin before the baseline moves",
  /preTransitionSessionRef\.current = \{ localOwned: localSessionOwnedRef\.current, sentLeaf: lastSentUrlLeafRef\.current \}/.test(dpc) &&
  /t\.phase === "failed-kept" \|\| t\.phase === "not-sent"/.test(dpc) &&
  dpc.indexOf("beginUrlTransition(opts?.origin ?? (opts?.automatic") < dpc.indexOf("      lastSentUrlLeafRef.current = step.leaf;"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
