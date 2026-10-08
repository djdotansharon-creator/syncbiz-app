/**
 * P0 Gate 1f (2026-10-08) — Desktop MAIN: (1) read-only readiness `mpvAttemptPending` (false exactly from
 * XFADE_RAMP_START for a standby load / first real progress for a cold load), mirrored in STATE_UPDATE + IPC snapshot;
 * (2) a FAILED / abandoned standby restores the audible session metadata (no controller shows the failed item over
 * the old music). REAL DeviceWsManager + PlaybackOrchestrator, synthetic MPV events. Metadata only — decks untouched.
 * Run (from desktop/): npx tsx scripts/verify-gate1f-session-restore.ts
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
type O = { musicDeckA: Deck; musicDeckB: Deck; currentAttemptDeck: "A" | "B"; activeMusicDeck: "A" | "B"; musicStA: { status: string }; musicStB: { status: string }; xfadeRampId: unknown };
type Mirror = { currentSource?: { id?: string } | null; currentTrack?: { title?: string } | null; currentTrackIndex?: number; status: string; mpvAttemptPending?: boolean };
const urlOf = (i: number) => `https://www.youtube.com/watch?v=itm${String(i).padStart(8, "0")}`;
const tracks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Track ${i}`, cover: null, url: urlOf(i) }));
const payload = (i: number) => ({ source: { id: `pl:track:r${i}`, title: `Track ${i}`, url: urlOf(i), type: "youtube", origin: "playlist", playlistId: "pl", sessionTracks: tracks }, trackIndex: i });

function world() {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const calls: string[] = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    const pl = d.play.bind(d), st = d.stop.bind(d), pa = d.pause.bind(d);
    d.play = (u, a) => { calls.push(`${id}:play`); pl(u, a); };
    d.stop = () => { calls.push(`${id}:stop`); st(); };
    d.pause = () => { calls.push(`${id}:pause`); pa(); };
  }
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void; mock: { getState: () => Mirror } };
  const toMain = (cmd: string, p?: unknown) => m.runTransportCommand(cmd, p, "ws");
  const mirror = () => m.mock.getState();
  const cur = () => (o.currentAttemptDeck === "A" ? o.musicDeckA : o.musicDeckB);
  const shown = () => `${mirror().currentSource?.id}|${mirror().currentTrack?.title}|${mirror().currentTrackIndex}`;
  const firstProgress = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 200 }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); d.handleEvent({ event: "property-change", name: "time-pos", data: 1 }); d.handleEvent({ event: "property-change", name: "time-pos", data: 2 }); };
  const failAtZero = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 225 }); d.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" }); };
  const audibleDeckPlaying = () => (o.activeMusicDeck === "A" ? o.musicStA : o.musicStB).status === "playing";
  /** item 0 audible + confirmed */
  const start = () => { toMain("PLAY_SOURCE", payload(0)); firstProgress(cur()); };
  return { orch, o, mgr, calls, toMain, mirror, cur, shown, firstProgress, failAtZero, audibleDeckPlaying, start };
}

// readiness flag
{
  const w = world();
  w.toMain("PLAY_SOURCE", payload(0));
  assert("R1 cold load requested → mpvAttemptPending true (mirror + IPC snapshot)", w.mirror().mpvAttemptPending === true && w.mgr.snapshot().mpvAttemptPending === true);
  w.firstProgress(w.cur());
  assert("R2 cold load first real progress → pending false", w.mirror().mpvAttemptPending === false && w.mgr.snapshot().mpvAttemptPending === false);
  w.toMain("PLAY_SOURCE", payload(3));
  assert("R3 standby load (old audible) → pending true; old deck audible", w.mirror().mpvAttemptPending === true && w.audibleDeckPlaying());
  const sb = w.cur();
  sb.handleEvent({ event: "start-file" }); sb.handleEvent({ event: "property-change", name: "duration", data: 200 }); sb.handleEvent({ event: "property-change", name: "core-idle", data: false });
  assert("R4 standby started but no progress yet → still pending (no ramp)", w.mirror().mpvAttemptPending === true && w.o.xfadeRampId === null);
  sb.handleEvent({ event: "property-change", name: "time-pos", data: 1 }); sb.handleEvent({ event: "property-change", name: "time-pos", data: 2 });
  assert("R5 standby proves readiness → XFADE_RAMP_START (ramp running) AND pending false at that moment", w.o.xfadeRampId !== null && w.mirror().mpvAttemptPending === false, `ramp=${w.o.xfadeRampId !== null}`);
  w.orch.kill();
}
// failed standby → restore
{
  const w = world(); w.start();
  const before = w.shown();
  w.toMain("PLAY_SOURCE", payload(3));
  assert("F1 standby pending: MAIN published the selection (metadata-first, unchanged behaviour)", w.shown() === "pl:track:r3|Track 3|3");
  const aud = w.o.activeMusicDeck;
  const stops = w.calls.filter((c) => c === aud + ":stop").length;
  w.failAtZero(w.cur());
  assert("F2 standby FAILS while the old deck is audible → session metadata restored to the audible item", w.shown() === before, w.shown());
  assert("F3 … audible deck untouched (still playing, never stopped)", w.audibleDeckPlaying() && w.o.activeMusicDeck === aud && w.calls.filter((c) => c === aud + ":stop").length === stops);
  // newest wins during pending → a failure restores the ORIGINAL audible session (never an intermediate one)
  w.toMain("PLAY_SOURCE", payload(4));
  w.toMain("PLAY_SOURCE", payload(6));
  w.failAtZero(w.cur());
  assert("F4 selection 4 then 6 while pending; 6 fails → restored to the ORIGINAL audible item 0", w.shown() === before, w.shown());
  w.orch.kill();
}
// ready standby → the new session stays
{
  const w = world(); w.start();
  w.toMain("PLAY_SOURCE", payload(2));
  w.firstProgress(w.cur());
  assert("C1 standby ready → session is the new item (no restore)", w.shown() === "pl:track:r2|Track 2|2");
  w.orch.kill();
}
// PAUSE / STOP during pending
{
  const w = world(); w.start();
  const before = w.shown();
  w.toMain("PLAY_SOURCE", payload(5));
  w.toMain("PAUSE");
  assert("P1 PAUSE during pending standby → audible (paused) item's metadata restored", w.shown() === before, w.shown());
  const w2 = world(); w2.start();
  w2.toMain("PLAY_SOURCE", payload(5)); w2.toMain("STOP");
  assert("P2 STOP during pending standby → restored to the item that was playing", w2.shown() === before);
  w.orch.kill(); w2.orch.kill();
}
// cold failure (nothing audible) → no restore (nothing to diverge from); LOCAL metadata sync unchanged
{
  const w = world();
  w.toMain("PLAY_SOURCE", payload(1)); w.failAtZero(w.cur());
  assert("N1 cold failure (nothing audible) → no restore; the failed item stays as an idle selection with its error", w.shown() === "pl:track:r1|Track 1|1" && w.mirror().status === "idle");
  w.toMain("PLAY_SOURCE", { source: { id: "local-pl", title: "Local", type: "local", url: "", origin: "playlist", sessionTracks: [{ id: "a", title: "A", cover: null }, { id: "b", title: "B", cover: null }] }, trackIndex: 1 });
  assert("N2 LOCAL metadata sync unchanged (type local, url stripped)", w.shown() === "local-pl|B|1");
  w.orch.kill();
}
// static: metadata only — no deck / orchestrator calls in the restore path
const src = readFileSync(path.join(__dirname, "..", "src", "device-websocket-client", "device-ws-manager.ts"), "utf-8").replace(/\r\n/g, "\n");
const restore = src.slice(src.indexOf("private settlePreLoadSession"), src.indexOf("/** Move mock station selection"));
assert("S1 restore path is metadata-only (no orchestrator / deck / play / stop calls)", !/orch\.|\.play(Music|MusicCrossfade)?\(|stopMusic|pauseMusic|setVolume/.test(restore));
assert("S2 orchestrator untouched by Gate 1f (no new orchestrator API used)", !/orch\.(restore|setPending|settle)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
