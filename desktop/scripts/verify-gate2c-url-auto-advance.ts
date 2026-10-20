/**
 * P0 Gate 2c (2026-10-08) — NO SILENCE BETWEEN URL TRACKS. MAIN owns the automatic progression of the URL session it
 * plays: the next item is PREPARED on the standby deck ~60 s before the end (loaded PAUSED + silent → resolved and
 * buffered), then handed over at the mix point (AUTOMIX on: the user's mix length, default 9 s; off: a 1 s change at
 * the end) through the EXISTING crossfade path (readiness → ramp → swap). Never destroys the audible track.
 * REAL PlaybackOrchestrator + DeviceWsManager (synthetic MPV events, no MPV process). Static pins at the end.
 * Run (from desktop/): npx tsx scripts/verify-gate2c-url-auto-advance.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager, setUrlPlaybackPrefs } from "../src/device-websocket-client/device-ws-manager";
import { nextAutoIndex, PREPARE_LEAD_SEC } from "../src/device-websocket-client/url-auto-advance";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void; preloadPaused: (u: string, id?: number) => void; resume: () => void; stop: () => void; pause: () => void; setVolume: (v: number) => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B"; currentAttemptDeck: "A" | "B"; xfadeRampId: unknown; musicStA: { status: string }; musicStB: { status: string } };
type Mirror = { currentSource?: { id?: string } | null; currentTrack?: { title?: string } | null; currentTrackIndex?: number; status: string };
const urlOf = (i: number) => `https://www.youtube.com/watch?v=auto${String(i).padStart(7, "0")}`;
const N = 5;
const tracks = Array.from({ length: N }, (_, i) => ({ id: `t${i}`, title: `Track ${i}`, cover: null, url: urlOf(i) }));
const payload = (i: number) => ({ source: { id: `pl:track:r${i}`, title: `Track ${i}`, url: urlOf(i), type: "youtube", origin: "playlist", playlistId: "pl", sessionTracks: tracks }, trackIndex: i });

function world() {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const calls: string[] = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    const pl = d.play.bind(d), pre = d.preloadPaused.bind(d), rs = d.resume.bind(d), st = d.stop.bind(d), pa = d.pause.bind(d);
    d.play = (u, a) => { calls.push(`${id}:play:${u}`); pl(u, a); };
    d.preloadPaused = (u, a) => { calls.push(`${id}:prepare:${u}`); pre(u, a); };
    d.resume = () => { calls.push(`${id}:resume`); rs(); };
    d.stop = () => { calls.push(`${id}:stop`); st(); };
    d.pause = () => { calls.push(`${id}:pause`); pa(); };
  }
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void; mock: { getState: () => Mirror } };
  const toMain = (cmd: string, p?: unknown) => m.runTransportCommand(cmd, p, "ws");
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const active = () => deck(o.activeMusicDeck);
  const standby = () => deck(o.activeMusicDeck === "A" ? "B" : "A");
  const at = (d: Deck, sec: number) => d.handleEvent({ event: "property-change", name: "time-pos", data: sec });
  const startPlaying = (d: Deck, dur = 200) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "file-loaded" }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); at(d, 1); at(d, 2); };
  const preparedLoads = (d: Deck, dur = 200) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "file-loaded" }); };
  const resumes = (d: Deck) => { d.handleEvent({ event: "property-change", name: "pause", data: false }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); at(d, 1); at(d, 2); };
  const failLoad = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" }); };
  const naturalEnd = (d: Deck) => { at(d, 199); d.handleEvent({ event: "end-file", reason: "eof" }); };
  const mirror = () => m.mock.getState();
  const shownIdx = () => mirror().currentTrackIndex;
  /** item i audible on the active deck (selected cold, playing) */
  const start = (i = 0) => { toMain("PLAY_SOURCE", payload(i)); startPlaying(active()); };
  return { orch, o, calls, mgr, toMain, deck, active, standby, at, startPlaying, preparedLoads, resumes, failLoad, naturalEnd, mirror, shownIdx, start };
}
const prepCount = (w: ReturnType<typeof world>) => w.calls.filter((c) => c.includes(":prepare:")).length;

// ── 1. prepare ~60 s before the end, hand over at the 9 s mix point (AUTOMIX on) ──
{
  setUrlPlaybackPrefs({ autoMix: true, repeatMode: "playlist" });
  const w = world(); w.start(0);
  const A = w.o.activeMusicDeck;
  w.at(w.active(), 130);
  assert("P1 70 s before the end → nothing prepared yet", prepCount(w) === 0);
  w.at(w.active(), 141);
  assert(`P2 ≤${PREPARE_LEAD_SEC} s before the end → item 1 prepared on the STANDBY deck, PAUSED (preloadPaused), active untouched`,
    prepCount(w) === 1 && w.calls.some((c) => c.endsWith(`:prepare:${urlOf(1)}`) && !c.startsWith(A)) && w.o.activeMusicDeck === A && w.shownIdx() === 0);
  assert("P3 MAIN declares it owns the automatic progression (renderer must not also step at EOF)", w.mgr.snapshot().mainUrlAutoAdvance === true);
  w.preparedLoads(w.standby());
  assert("P4 prepared item loaded + duration known → ready (still silent, not the current attempt)", w.orch.getPrepared()?.ready === true && w.shownIdx() === 0);
  w.at(w.active(), 185);
  assert("P5 15 s before the end (> 9 s mix) → not handed over yet", !w.calls.some((c) => c.endsWith(":resume")));
  w.at(w.active(), 191);
  assert("P6 at the 9 s mix point → prepared deck RESUMED (handed over); session now item 1", w.calls.filter((c) => c.endsWith(":resume")).length === 1 && w.shownIdx() === 1 && w.mirror().currentTrack?.title === "Track 1");
  const outgoing = w.deck(A);
  assert("P7 outgoing track still audible while the incoming starts (no silence)", (A === "A" ? w.o.musicStA : w.o.musicStB).status === "playing" && !w.calls.includes(`${A}:stop`));
  w.resumes(w.standby());
  assert("P8 incoming shows real progress → crossfade ramp running (existing readiness → ramp path)", w.o.xfadeRampId !== null);
  void outgoing;
  w.orch.kill();
}
// ── 2. AUTOMIX off → quick 1 s change at the very end (still prepared ahead, still no silence) ──
{
  setUrlPlaybackPrefs({ autoMix: false, repeatMode: "playlist" });
  const w = world(); w.start(0);
  w.at(w.active(), 150); w.preparedLoads(w.standby());
  w.at(w.active(), 195);
  assert("O1 AUTOMIX off: 5 s before the end → not handed over", !w.calls.some((c) => c.endsWith(":resume")));
  w.at(w.active(), 199);
  assert("O2 AUTOMIX off: ≤1 s before the end → handed over (gapless-style)", w.calls.filter((c) => c.endsWith(":resume")).length === 1 && w.shownIdx() === 1);
  w.orch.kill();
  setUrlPlaybackPrefs({ autoMix: true });
}
// ── 3. next not ready in time → at natural end MAIN continues immediately (never silence) ──
{
  const w = world(); w.start(0);
  w.at(w.active(), 150); // prepared but never loads
  w.naturalEnd(w.active());
  assert("E1 prepared item never became ready → at the natural end MAIN loads item 1 directly", w.shownIdx() === 1 && w.calls.some((c) => c.includes(`:play:${urlOf(1)}`)));
  w.orch.kill();
  const w2 = world(); w2.start(0);
  w2.at(w2.active(), 150); w2.preparedLoads(w2.standby());
  setUrlPlaybackPrefs({ autoMix: false }); // ready but mix point skipped (e.g. track ended early)
  w2.naturalEnd(w2.active());
  assert("E2 prepared + ready at the natural end → handed over at once (no reload, no silence)", w2.calls.filter((c) => c.endsWith(":resume")).length === 1 && w2.shownIdx() === 1 && !w2.calls.some((c) => c.includes(`:play:${urlOf(1)}`)));
  setUrlPlaybackPrefs({ autoMix: true });
  w2.orch.kill();
}
// ── 4. prepared item fails → the FOLLOWING item is prepared; the audible track is untouched ──
{
  const w = world(); w.start(0);
  const A = w.o.activeMusicDeck;
  w.at(w.active(), 150);
  w.failLoad(w.standby());
  w.at(w.active(), 151);
  w.at(w.active(), 152);
  assert("F1 prepared item 1 failed → item 2 prepared instead; active deck never stopped", w.calls.some((c) => c.endsWith(`:prepare:${urlOf(2)}`)) && !w.calls.includes(`${A}:stop`) && w.shownIdx() === 0);
  w.orch.kill();
}
// ── 5. hand-over fails after resume → MAIN keeps the audible track (Gate 2a) and rolls the session back ──
{
  const w = world(); w.start(0);
  w.at(w.active(), 150); w.preparedLoads(w.standby());
  w.at(w.active(), 192);
  assert("H0 handed over to item 1", w.shownIdx() === 1);
  w.standby().handleEvent({ event: "end-file", reason: "error", file_error: "stream died" });
  assert("H1 incoming failed → MAIN reports the audible item again and the session/metadata roll back to item 0",
    w.shownIdx() === 0 && w.mirror().status === "playing", `idx=${w.shownIdx()}`);
  w.at(w.active(), 193); w.at(w.active(), 194);
  assert("H2 → the following item (2) is prepared to keep the music going", w.calls.some((c) => c.endsWith(`:prepare:${urlOf(2)}`)));
  w.orch.kill();
}
// ── 5b. end-of-track hand-over fails with NOTHING audible → fail forward to the following item (no silence) ──
const h3 = (async () => {
  setUrlPlaybackPrefs({ autoMix: false });
  const w = world(); w.start(0);
  w.at(w.active(), 150); w.preparedLoads(w.standby());
  w.naturalEnd(w.active()); // hand-over at the natural end (outgoing already silent)
  assert("H3a end-of-track hand-over to item 1", w.shownIdx() === 1);
  w.standby().handleEvent({ event: "end-file", reason: "error", file_error: "stream died" });
  w.active().handleEvent({ event: "end-file", reason: "error", file_error: "stream died" });
  await Promise.resolve(); await Promise.resolve();
  assert("H3 hand-over failed with nothing audible → MAIN loads the following item (2) at once", w.calls.some((c) => c.includes(`:play:${urlOf(2)}`)) && w.shownIdx() === 2, `idx=${w.shownIdx()}`);
  setUrlPlaybackPrefs({ autoMix: true });
  w.orch.kill();
})();
// ── 6. loop rules (LOCAL parity) ──
{
  const f = new Set<number>();
  assert("L1 loop playlist: after the last item → item 0", nextAutoIndex({ items: tracks as never, index: N - 1 }, "playlist", f) === 0);
  assert("L2 loop off: after the last item → nothing (the owner's explicit choice)", nextAutoIndex({ items: tracks as never, index: N - 1 }, "off", f) === null);
  assert("L3 loop track: the same item", nextAutoIndex({ items: tracks as never, index: 2 }, "track", f) === 2);
  assert("L4 failed / URL-less items are skipped", nextAutoIndex({ items: tracks as never, index: 0 }, "playlist", new Set([1, 2])) === 3);
}
// ── 7. manual selection while an item is prepared; LOCAL never auto-advanced ──
{
  const w = world(); w.start(0);
  w.at(w.active(), 150); w.preparedLoads(w.standby());
  w.toMain("PLAY_SOURCE", payload(3));
  assert("M1 manual selection while item 1 is prepared → the prepared item is replaced by the selection (exact track 3)", w.orch.getPrepared() === null && w.shownIdx() === 3 && w.calls.some((c) => c.includes(`:play:${urlOf(3)}`)));
  w.orch.kill();
  const w2 = world();
  w2.orch.playMusic("C:\\music\\one.mp3", 7); w2.startPlaying(w2.active());
  w2.toMain("PLAY_SOURCE", { source: { id: "local-pl", title: "Local", type: "local", url: "", origin: "playlist", sessionTracks: [{ id: "a", title: "A", cover: null }] }, trackIndex: 0 });
  w2.at(w2.active(), 150);
  assert("M2 LOCAL session → MAIN prepares nothing (LOCAL stays with the renderer engine)", prepCount(w2) === 0 && w2.mgr.snapshot().mainUrlAutoAdvance === false);
  w2.orch.kill();
}

// ── 8. a playlist SHELL selection (phone "play all") advances through the playlist ──
{
  const w = world();
  w.toMain("PLAY_SOURCE", { source: { id: "pl", title: "Playlist", url: urlOf(0), type: "youtube", origin: "playlist", playlistId: "pl", sessionTracks: tracks }, trackIndex: 0 });
  w.startPlaying(w.active());
  w.at(w.active(), 150);
  assert("M3 shell selection → item 1 prepared next (never a loop of the first track)", w.calls.some((c) => c.endsWith(`:prepare:${urlOf(1)}`)));
  w.orch.kill();
}

// ── static pins ──
const rd = (p: string) => readFileSync(path.join(__dirname, "..", "..", p), "utf-8").replace(/\r\n/g, "\n");
const mpv = rd("desktop/src/main/mpv-manager.ts");
const dpc = rd("lib/device-player-context.tsx");
assert("S1 MPV play() unchanged: still loads and forces pause=false (freeze fix); preload is a separate paused path",
  /play\(url: string, attemptId = 0\): void \{\n    this\.loadInternal\(url, attemptId, false\);/.test(mpv) && /if \(startPaused\) return;[^\n]*\n[\s\S]*?this\.cmd\(\["set_property", "pause", false\]\);/.test(mpv));
assert("S2 renderer never steps a URL attempt MAIN auto-advances (mainUrlAutoAdvance gate on the EOF step)", /st\?\.mainUrlAutoAdvance !== true;/.test(dpc));
assert("S3 renderer pushes AUTOMIX + loop to MAIN and rebases its session baseline on MAIN's advance",
  /desktop\.setPlaybackPrefs\(\{ autoMix: getAutoMix\(\), repeatMode: getRepeatMode\(\) \}\)/.test(dpc) && /lastSentUrlLeafRef\.current = leaf;/.test(dpc));
assert("S4 default mix length 9 s (renderer + MAIN)", /const DEFAULT_MIX_DURATION: MixDuration = 9;/.test(rd("lib/mix-preferences.ts")) && new PlaybackOrchestrator().getCrossfadeSec() === 9);

void h3.then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
});
