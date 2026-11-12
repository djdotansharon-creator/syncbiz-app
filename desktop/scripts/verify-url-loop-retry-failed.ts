/**
 * Owner 2026-11-04 — the Lenovo (14:31Z) and the Dev-PC (14:51Z) went SILENT: each looped ONE URL song; one transient
 * failed prepare of that same song marked it failed for the run, so at the natural end nothing was left → URL_AUTO_END.
 * Rule: an item marked failed in this run never ends the music when it is the ONLY thing blocking the loop — MAIN tries it
 * again (capped by MAX_AUTO_FAILURES, so a really dead item never loops forever). Loop "off" at the end stays a stop.
 * REAL PlaybackOrchestrator + DeviceWsManager (synthetic MPV events, no MPV process), same harness as Gate 2c.
 * Run (from desktop/): npx tsx scripts/verify-url-loop-retry-failed.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager, setUrlPlaybackPrefs } from "../src/device-websocket-client/device-ws-manager";
import { MAX_AUTO_FAILURES, retryIndexAfterFailures } from "../src/device-websocket-client/url-auto-advance";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void; preloadPaused: (u: string, id?: number) => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B" };
const SONG = "https://www.youtube.com/watch?v=loop0000001";
const single = { source: { id: "url-loop-1", title: "Loop song", url: SONG, type: "youtube", origin: "source" }, trackIndex: 0 };
const urlOf = (i: number) => `https://www.youtube.com/watch?v=list${String(i).padStart(7, "0")}`;
const tracks = Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, title: `Track ${i}`, cover: null, url: urlOf(i) }));
const listPayload = (i: number) => ({ source: { id: `pl:track:r${i}`, title: `Track ${i}`, url: urlOf(i), type: "youtube", origin: "playlist", playlistId: "pl", sessionTracks: tracks }, trackIndex: i });

function world() {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const calls: string[] = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    const pl = d.play.bind(d), pre = d.preloadPaused.bind(d);
    d.play = (u, a) => { calls.push(`${id}:play:${u}`); pl(u, a); };
    d.preloadPaused = (u, a) => { calls.push(`${id}:prepare:${u}`); pre(u, a); };
  }
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void };
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const active = () => deck(o.activeMusicDeck);
  const standby = () => deck(o.activeMusicDeck === "A" ? "B" : "A");
  const at = (d: Deck, sec: number) => d.handleEvent({ event: "property-change", name: "time-pos", data: sec });
  const startPlaying = (d: Deck, dur = 200) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "file-loaded" }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); at(d, 1); at(d, 2); };
  const failLoad = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" }); };
  const naturalEnd = (d: Deck) => { at(d, 199); d.handleEvent({ event: "end-file", reason: "eof" }); };
  const plays = (u: string) => calls.filter((c) => c.endsWith(`:play:${u}`)).length;
  const lastPlayDeck = (u: string) => { const c = [...calls].reverse().find((x) => x.endsWith(`:play:${u}`)); return deck((c ?? "A")[0] as "A" | "B"); };
  const play = (p: unknown) => { m.runTransportCommand("PLAY_SOURCE", p, "ws"); startPlaying(active()); };
  return { orch, calls, active, standby, at, startPlaying, failLoad, naturalEnd, plays, lastPlayDeck, play };
}

// ── 1. today's incident, exactly: one looping song, its prepare fails once, natural end → it plays AGAIN (not silence) ──
{
  setUrlPlaybackPrefs({ autoMix: true, repeatMode: "playlist" });
  const w = world(); w.play(single);
  w.at(w.active(), 150);
  assert("R0 the looping song's next round is prepared on the standby deck", w.calls.some((c) => c.endsWith(`:prepare:${SONG}`)));
  w.failLoad(w.standby());
  w.at(w.active(), 151); w.at(w.active(), 152);
  assert("R1 the prepare failed → no immediate re-prepare spree (the retry waits for the natural end)", w.calls.filter((c) => c.includes(":prepare:")).length === 1);
  w.naturalEnd(w.active());
  assert("R2 natural end → the same song is LOADED AGAIN (before the fix: URL_AUTO_END = silence)", w.plays(SONG) === 2, `plays=${w.plays(SONG)}`);
  w.startPlaying(w.lastPlayDeck(SONG));
  w.at(w.active(), 150);
  assert("R3 the retried round plays and the NEXT round is prepared normally again (loop continues)", w.calls.filter((c) => c.endsWith(`:prepare:${SONG}`)).length === 2);
  w.orch.kill();
}
// ── 2. same with loop "track" ──
{
  setUrlPlaybackPrefs({ repeatMode: "track" });
  const w = world(); w.play(single);
  w.at(w.active(), 150); w.failLoad(w.standby()); w.at(w.active(), 151);
  w.naturalEnd(w.active());
  assert("T1 loop 'track': failed prepare + natural end → the song is loaded again", w.plays(SONG) === 2);
  w.orch.kill();
  setUrlPlaybackPrefs({ repeatMode: "playlist" });
}
// ── 3. a really dead item never loops forever (capped) ──
{
  const w = world(); w.play(single);
  w.at(w.active(), 150); w.failLoad(w.standby()); w.at(w.active(), 151);
  w.naturalEnd(w.active());
  for (let k = 0; k < 6; k++) w.failLoad(w.lastPlayDeck(SONG));
  const n = w.plays(SONG);
  assert(`C1 every retry fails → retries stop after ${MAX_AUTO_FAILURES} consecutive failures (no endless reload loop)`, n >= 2 && n <= 1 + MAX_AUTO_FAILURES, `plays=${n}`);
  w.orch.kill();
}
// ── 4. loop "off" at the end of the list stays the operator's stop ──
{
  setUrlPlaybackPrefs({ repeatMode: "off" });
  const w = world(); w.play(single);
  w.at(w.active(), 150);
  w.naturalEnd(w.active());
  assert("O1 loop 'off' (explicit choice): the single song ends → nothing reloaded (unchanged)", w.plays(SONG) === 1);
  w.orch.kill();
  setUrlPlaybackPrefs({ repeatMode: "playlist" });
}
// ── 5. a list with healthy items keeps skipping the failed one (unchanged Gate 2c F1 behaviour) ──
{
  const w = world(); w.play(listPayload(0));
  w.at(w.active(), 150); w.failLoad(w.standby());
  w.at(w.active(), 151); w.at(w.active(), 152);
  assert("L1 3-item list: prepared item 1 failed → item 2 prepared instead (failed item still skipped while others play)", w.calls.some((c) => c.endsWith(`:prepare:${urlOf(2)}`)));
  w.orch.kill();
}
// ── 6. pure rule ──
{
  const one = { items: [{ id: "a", title: "", cover: null, url: SONG }], index: 0 };
  const three = { items: tracks, index: 0 };
  assert("P1 no failed marks → nothing to retry", retryIndexAfterFailures(one, "playlist", new Set()) === null);
  assert("P2 one song, marked failed, loop playlist → retry item 0", retryIndexAfterFailures(one, "playlist", new Set([0])) === 0);
  assert("P3 list where a healthy item remains → no retry (the normal next wins)", retryIndexAfterFailures(three, "playlist", new Set([1])) === null);
  assert("P4 list where every item is marked failed → retry the loop's next item (1)", retryIndexAfterFailures(three, "playlist", new Set([0, 1, 2])) === 1);
  assert("P5 loop off at the last item → no retry (operator's stop)", retryIndexAfterFailures({ items: tracks, index: 2 }, "off", new Set([0])) === null);
}
// ── static pins ──
{
  const src = readFileSync(path.join(__dirname, "..", "src", "device-websocket-client", "device-ws-manager.ts"), "utf-8").replace(/\r\n/g, "\n");
  const body = src.slice(src.indexOf("private autoLoadNext("), src.indexOf("private mainNav("));
  assert("S1 the cap is checked BEFORE any retry (MAX_AUTO_FAILURES → EXHAUSTED first)", body.indexOf("MAX_AUTO_FAILURES") < body.indexOf("retryIndexAfterFailures"));
  assert("S2 never retried during an unproven / dormant restore (Gate 2d LOCAL fail-over unchanged)", /!this\.restoreVerifying && !this\.restoreDormant\)[\s\S]{0,80}retryIndexAfterFailures/.test(body));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
