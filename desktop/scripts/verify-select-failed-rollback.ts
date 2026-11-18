/**
 * Owner 2026-11-04 (Dev-PC, 19:51–19:54Z) — a SoundCloud single (MAIN attempt) was audible; four explicit selections of
 * unplayable items each failed on the standby deck (XFADE_ABORT standby_decode_failed → audible restored). MAIN's
 * automatic progression kept watching the FAILED attempt, so the audible song's natural end was never handled → silence.
 * Rule: a failed explicit selection rolls MAIN's auto-advance back to the still-audible attempt (the music continues).
 * REAL PlaybackOrchestrator + DeviceWsManager (synthetic MPV events, no MPV process), same harness as Gate 2c.
 * Run (from desktop/): npx tsx scripts/verify-select-failed-rollback.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager, setUrlPlaybackPrefs } from "../src/device-websocket-client/device-ws-manager";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void; preloadPaused: (u: string, id?: number) => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B" };
type Mirror = { currentSource?: { id?: string } | null; currentTrack?: { title?: string } | null; status: string };
const SONG = "https://soundcloud.com/artist/the-audible-song";
const BAD = (i: number) => `https://cdn.example.com/broken-${i}.wav`;
const single = (id: string, url: string, title: string, type = "soundcloud") => ({ source: { id, title, url, type, origin: "source" }, trackIndex: 0 });
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
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void; mock: { getState: () => Mirror } };
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const active = () => deck(o.activeMusicDeck);
  const standby = () => deck(o.activeMusicDeck === "A" ? "B" : "A");
  const at = (d: Deck, sec: number) => d.handleEvent({ event: "property-change", name: "time-pos", data: sec });
  const startPlaying = (d: Deck, dur = 200) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "file-loaded" }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); at(d, 1); at(d, 2); };
  const failLoad = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" }); };
  const naturalEnd = (d: Deck) => { at(d, 199); d.handleEvent({ event: "end-file", reason: "eof" }); };
  const select = (p: unknown) => m.runTransportCommand("PLAY_SOURCE", p, "ws");
  const plays = (u: string) => calls.filter((c) => c.endsWith(`:play:${u}`)).length;
  const prepares = (u: string) => calls.filter((c) => c.endsWith(`:prepare:${u}`)).length;
  const lastPlayDeck = (u: string) => { const c = [...calls].reverse().find((x) => x.endsWith(`:play:${u}`)); return deck((c ?? "A")[0] as "A" | "B"); };
  const mirror = () => m.mock.getState();
  return { orch, mgr, calls, active, standby, at, startPlaying, failLoad, naturalEnd, select, plays, prepares, lastPlayDeck, mirror };
}

setUrlPlaybackPrefs({ autoMix: true, repeatMode: "playlist" });
// ── 1. tonight's incident: audible single, FOUR failed selections, then the audible song ends → the music continues ──
{
  const w = world();
  w.select(single("sc-1", SONG, "Audible song")); w.startPlaying(w.active());
  w.at(w.active(), 20);
  const prepBefore = w.prepares(SONG);
  for (let i = 1; i <= 4; i++) {
    w.select(single(`dl-${i}`, BAD(i), `Broken ${i}`, "stream-url"));
    w.failLoad(w.lastPlayDeck(BAD(i)));
    w.at(w.active(), 20 + i);
  }
  assert("I1 every failed selection left the audible song playing (Gate 2a, unchanged) and its title is shown again", w.mirror().currentTrack?.title === "Audible song" || w.mirror().currentSource?.id === "sc-1", JSON.stringify(w.mirror().currentSource));
  w.at(w.active(), 150);
  assert("I2 MAIN's auto-advance follows the AUDIBLE song again: its next round is prepared AFTER the failures (before the fix: nothing)", w.prepares(SONG) > prepBefore, `prepares ${prepBefore}→${w.prepares(SONG)}`);
  const before = w.plays(SONG) + w.prepares(SONG);
  w.naturalEnd(w.active());
  w.at(w.active(), 1); w.at(w.active(), 2);
  assert("I3 the audible song's natural end continues the music (hand-over or reload) — never silence", w.calls.some((c) => c.endsWith(":resume")) || w.plays(SONG) + w.prepares(SONG) > before, `calls tail=${w.calls.slice(-4).join(",")}`);
  w.orch.kill();
}
// ── 2. one failed selection over a PLAYLIST → the playlist continues at its next item ──
{
  const w = world();
  w.select(listPayload(0)); w.startPlaying(w.active());
  w.at(w.active(), 20);
  const p1Before = w.prepares(urlOf(1));
  w.select(single("dl-x", BAD(9), "Broken", "stream-url"));
  w.failLoad(w.lastPlayDeck(BAD(9)));
  w.at(w.active(), 150);
  assert("P1 failed selection over a playlist → the playlist's NEXT item (1) is prepared again after the failure", w.prepares(urlOf(1)) === p1Before + 1, `prepares ${p1Before}→${w.prepares(urlOf(1))}`);
  w.orch.kill();
}
// ── 3. a selection that WORKS is unchanged: the new source is what MAIN advances ──
{
  const w = world();
  w.select(single("sc-1", SONG, "Audible song")); w.startPlaying(w.active());
  w.at(w.active(), 20);
  w.select(listPayload(0));
  w.startPlaying(w.lastPlayDeck(urlOf(0)));
  w.at(w.active(), 30);
  const sess = (w.mgr as unknown as { urlSession: { sourceId: string } | null }).urlSession;
  assert("W1 a selection that plays → MAIN keeps the NEW source as its session (never rolled back to the old song)", sess?.sourceId === "pl:track:r0", `session=${sess?.sourceId}`);
  w.orch.kill();
}
// ── 4. nothing audible (cold selection fails) → no rollback target, nothing invented ──
{
  const w = world();
  w.select(single("dl-1", BAD(1), "Broken", "stream-url"));
  w.failLoad(w.lastPlayDeck(BAD(1)));
  assert("C1 a cold selection that fails → no rollback (there was no audible song); no other load started", w.calls.filter((c) => c.includes(":play:") && !c.endsWith(BAD(1))).length === 0);
  w.orch.kill();
}
// ── static pins ──
{
  const src = readFileSync(path.join(__dirname, "..", "src", "device-websocket-client", "device-ws-manager.ts"), "utf-8").replace(/\r\n/g, "\n");
  assert("S1 rollback only when MAIN reports the previous AUDIBLE attempt playing again while still watching the failed one", /watched === sr\.failedAttemptId && id === sr\.prevAudibleAttemptId && m\.status === "playing" && !orch\.isMusicAttemptPending\(\)/.test(src));
  assert("S2 recorded only for a standby (crossfade) selection over something audible", /ms\.attemptMode === "crossfade"[^\n]*prevAudibleAttemptId > 0/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
