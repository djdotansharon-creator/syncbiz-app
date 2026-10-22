/**
 * P0 Gate 1a (2026-10-07) — NEVER DESTROY PROVEN AUDIBLE PLAYBACK FOR UNPROVEN NEW PLAYBACK (Desktop MAIN).
 * Drives the REAL DeviceWsManager command routing + REAL PlaybackOrchestrator / MpvManager event handling (synthetic
 * MPV IPC events, no MPV process). Proves: every WS URL load goes through playMusicCrossfade (audible deck untouched,
 * standby load), a failed standby (pos 0 / error / timeout) leaves the audible deck playing, cold only when nothing is
 * audible, PLAY with no URL never restarts a pending attempt, identical PLAY_SOURCE for a pending target is ignored.
 * Run (from desktop/): npx tsx scripts/verify-gate1a-audible-protection.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager } from "../src/device-websocket-client/device-ws-manager";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void; stop: () => void; setVolume: (v: number) => void; pause: () => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B"; currentAttemptDeck: "A" | "B"; currentAttemptId: number; xfadePending: unknown };
const URL1 = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const URL2 = "https://www.youtube.com/watch?v=bbbbbbbbbbb";
const LOCAL = "C:\\music\\one.mp3";

function harness() {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const calls: string[] = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    const pl = d.play.bind(d), st = d.stop.bind(d), sv = d.setVolume.bind(d), pa = d.pause.bind(d);
    d.play = (u, a) => { calls.push(`${id}:play`); pl(u, a); };
    d.stop = () => { calls.push(`${id}:stop`); st(); };
    d.setVolume = (v) => { calls.push(`${id}:vol=${v}`); sv(v); };
    d.pause = () => { calls.push(`${id}:pause`); pa(); };
  }
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const route = (cmd: string, payload: unknown) => (mgr as unknown as { routeToOrchestrator: (c: string, p: unknown) => void }).routeToOrchestrator(cmd, payload);
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const cur = () => deck(o.currentAttemptDeck);
  const playing = (d: Deck, dur = 200) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); d.handleEvent({ event: "property-change", name: "time-pos", data: 1 }); d.handleEvent({ event: "property-change", name: "time-pos", data: 2 }); };
  const playSource = (id: string, url: string, trackIndex = 0) => route("PLAY_SOURCE", { source: { id, title: id, url, type: "youtube", origin: "playlist" }, trackIndex });
  const activeTouched = (active: "A" | "B", since: number) => calls.slice(since).filter((c) => c.startsWith(`${active}:`) && !/^.:vol=80$/.test(c));
  return { orch, o, calls, route, deck, cur, playing, playSource, activeTouched };
}

// 1. audible LOCAL + a pending/failed current attempt + WS URL load → the audible deck is never replaced
{
  const h = harness();
  h.orch.playMusic(LOCAL, 7); h.playing(h.deck("A")); // LOCAL audibly playing on A (renderer attempt 7)
  const mark = h.calls.length;
  h.playSource("pl#1", URL1, 1);                        // URL selected → must go to standby B
  assert("1a WS PLAY_SOURCE with audible deck → standby load (B), active A untouched", h.o.currentAttemptDeck === "B" && h.calls.slice(mark).includes("B:play") && h.activeTouched("A", mark).length === 0, h.calls.slice(mark).join(","));
  // pos-0 failure of the standby (yt-dlp resolved, start-file, duration known, then end-file error at pos 0)
  const sb = h.deck("B");
  // Updated 2026-10-08 (P0 Gate 2a item 3): the failure is surfaced ONCE in the status stream (controllers observe it),
  // then MAIN reports the still-audible deck A again (it must never lose visibility of audible playback).
  const failedId = h.orch.getState().music.attemptId;
  const seen: Array<{ attemptId: number; status: string; lastError: string | null }> = [];
  const ol = (h.orch as unknown as { listener?: (s: { music: { attemptId: number; status: string; lastError: string | null } }) => void }).listener;
  (h.orch as unknown as { listener: (s: { music: { attemptId: number; status: string; lastError: string | null } }) => void }).listener = (s) => { seen.push({ ...s.music }); ol?.(s); };
  sb.handleEvent({ event: "start-file" }); sb.handleEvent({ event: "property-change", name: "duration", data: 225 });
  sb.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" });
  const st = h.orch.getState();
  assert("1b standby fails at pos 0 → audible A keeps playing, never stopped / lowered; failure surfaced ONCE on the URL attempt, then A reported",
    h.activeTouched("A", mark).length === 0 && h.o.activeMusicDeck === "A" && (h.o as unknown as { musicStA: { status: string } }).musicStA.status === "playing" &&
    seen.filter((m) => m.attemptId === failedId && m.status === "idle" && !!m.lastError).length === 1 && st.music.attemptId === 7 && st.music.status === "playing" && !st.music.lastError);
  // the OLD (pre-1a) defect: current attempt now reads idle+error although A is audible → a 2nd URL must STILL go to standby
  const mark2 = h.calls.length;
  h.playSource("pl#2", URL2, 2);
  assert("1c after a FAILED attempt (snapshot idle) the next WS URL still uses standby — never cold-replaces audible A", h.activeTouched("A", mark2).length === 0 && h.calls.slice(mark2).includes("B:play"), h.calls.slice(mark2).join(","));
  h.orch.kill();
}
// 2. nothing audible → cold load (allowed: nothing to destroy)
{
  const h = harness();
  h.playSource("pl#0", URL1, 0);
  assert("2 nothing audible → cold load on the active deck", h.o.currentAttemptDeck === h.o.activeMusicDeck && h.calls.includes("A:play"));
  h.orch.kill();
}
// 3. PLAY (no url) spam while the URL attempt is pending → no reload
{
  const h = harness();
  h.orch.playMusic(LOCAL, 7); h.playing(h.deck("A"));
  h.playSource("pl#1", URL1, 1);
  const loads = () => h.calls.filter((c) => c.endsWith(":play")).length;
  const before = loads();
  for (let i = 0; i < 10; i++) h.route("PLAY", undefined);
  assert("3 10× PLAY while the URL attempt is pending → 0 reloads, audible A untouched", loads() === before && h.orch.isMusicAttemptPending());
  h.orch.kill();
}
// 4. identical PLAY_SOURCE spam for the pending target → one effective load
{
  const h = harness();
  h.orch.playMusic(LOCAL, 7); h.playing(h.deck("A"));
  for (let i = 0; i < 10; i++) h.playSource("pl#1", URL1, 1);
  const loads = h.calls.filter((c) => c.endsWith(":play")).length;
  assert("4 10× identical PLAY_SOURCE (same id + trackIndex) while pending → 1 effective URL load", loads === 2, String(loads)); // 1 LOCAL + 1 URL
  // a DIFFERENT target is a deliberate override → allowed (latest explicit choice wins)
  h.playSource("pl#2", URL2, 2);
  assert("4b a different target during pending → accepted (newest deliberate selection wins)", h.calls.filter((c) => c.endsWith(":play")).length === 3);
  h.orch.kill();
}
// 5. once the URL is proven playing, the same target may be requested again (not pending any more)
{
  const h = harness();
  h.playSource("pl#1", URL1, 1); h.playing(h.cur());
  assert("5a attempt with real progress is no longer pending", h.orch.isMusicAttemptPending() === false);
  const before = h.calls.filter((c) => c.endsWith(":play")).length;
  h.route("PLAY", undefined); // playing + not pending → existing behaviour (crossfade reload of current source)
  assert("5b PLAY when nothing is pending keeps existing behaviour (no new block)", h.calls.filter((c) => c.endsWith(":play")).length === before + 1);
  h.orch.kill();
}
// 6. STOP / PAUSE always work during a pending load
{
  const h = harness();
  h.orch.playMusic(LOCAL, 7); h.playing(h.deck("A"));
  h.playSource("pl#1", URL1, 1);
  h.route("PAUSE", undefined);
  assert("6a PAUSE during pending → aborts the standby and pauses the audible deck", h.calls.includes("A:pause") && h.o.xfadePending === null);
  h.playSource("pl#1", URL1, 1);
  h.route("STOP", undefined);
  assert("6b STOP during pending → both decks stopped", h.calls.includes("A:stop") && h.calls.includes("B:stop"));
  h.orch.kill();
}

// static pins
const src = readFileSync(path.join(__dirname, "..", "src", "device-websocket-client", "device-ws-manager.ts"), "utf-8").replace(/\r\n/g, "\n");
const route = src.slice(src.indexOf("private routeToOrchestrator"), src.indexOf('case "PAUSE":', src.indexOf("private routeToOrchestrator")));
assert("S1 no cold orch.playMusic(...) left in WS URL routing", !/orch\.playMusic\(/.test(route), "");
assert("S2 no current-attempt-status audibility inference left in WS URL routing", !/getState\(\)\.music\.status === "playing"/.test(route));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
