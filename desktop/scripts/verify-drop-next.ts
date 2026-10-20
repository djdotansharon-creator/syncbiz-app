/**
 * P0 Drop Next (2026-10-08) — owner rules: a dropped URL plays next; a dropped playlist adds ALL its tracks in order;
 * after the queue the playlist resumes EXACTLY where it stopped; during LOCAL the queued items play after the current
 * LOCAL track and then LOCAL resumes. MAIN owns the queue (URLs only); same prepare-ahead + mix as Gate 2c; NEXT / PREV
 * for MAIN's own URL / queued items run in MAIN (one navigation at a time).
 * REAL PlaybackOrchestrator + DeviceWsManager (synthetic MPV events). Static pins on the renderer wiring at the end.
 * Run (from desktop/): npx tsx scripts/verify-drop-next.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager, setUrlPlaybackPrefs } from "../src/device-websocket-client/device-ws-manager";
import { buildQueueItems } from "../src/device-websocket-client/url-auto-advance";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void; preloadPaused: (u: string, id?: number) => void; resume: () => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B"; settleXfadeNow: (r: string) => void };
type Mirror = { currentSource?: { id?: string } | null; currentTrack?: { title?: string } | null; currentTrackIndex?: number; playNextQueue?: Array<{ id: string; title: string }> };
const urlOf = (i: number) => `https://www.youtube.com/watch?v=pl${String(i).padStart(9, "0")}`;
const qUrl = (i: number) => `https://www.youtube.com/watch?v=qq${String(i).padStart(9, "0")}`;
const tracks = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, title: `Track ${i}`, cover: null, url: urlOf(i) }));
const payload = (i: number) => ({ source: { id: `pl:track:r${i}`, title: `Track ${i}`, url: urlOf(i), type: "youtube", origin: "playlist", playlistId: "pl", sessionTracks: tracks }, trackIndex: i });
const dropUrl = (i: number) => ({ source: { id: `url-${i}`, title: `Dropped ${i}`, url: qUrl(i), type: "youtube", origin: "source" } });
const dropPlaylist = { source: { id: "pl2", title: "Other", url: qUrl(10), type: "youtube", origin: "playlist", playlistId: "pl2", sessionTracks: [10, 11, 12].map((i) => ({ id: `q${i}`, title: `Q${i}`, cover: null, url: qUrl(i) })) } };

function world() {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const calls: string[] = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    const pl = d.play.bind(d), pre = d.preloadPaused.bind(d), rs = d.resume.bind(d);
    d.play = (u, a) => { calls.push(`${id}:play:${u}`); pl(u, a); };
    d.preloadPaused = (u, a) => { calls.push(`${id}:prepare:${u}`); pre(u, a); };
    d.resume = () => { calls.push(`${id}:resume`); rs(); };
  }
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void; handleRemoteStep: (c: "NEXT" | "PREV") => void; mock: { getState: () => Mirror } };
  const toMain = (cmd: string, p?: unknown) => { if (cmd === "NEXT" || cmd === "PREV") m.handleRemoteStep(cmd); else m.runTransportCommand(cmd, p, "ws"); };
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const active = () => deck(o.activeMusicDeck);
  const standby = () => deck(o.activeMusicDeck === "A" ? "B" : "A");
  const at = (d: Deck, sec: number) => d.handleEvent({ event: "property-change", name: "time-pos", data: sec });
  const startPlaying = (d: Deck, dur = 200) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "file-loaded" }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); at(d, 1); at(d, 2); };
  const preparedLoads = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 200 }); d.handleEvent({ event: "file-loaded" }); };
  const resumes = (d: Deck) => { d.handleEvent({ event: "property-change", name: "pause", data: false }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); at(d, 1); at(d, 2); };
  /** the ramp runs on a real interval timer — complete the swap now through the orchestrator's own early-settle path */
  const finishRamp = () => o.settleXfadeNow("test: complete the ramp");
  /** play the current item to its mix point and through the hand-over, so the next item becomes the playing one */
  const mixThrough = () => { at(active(), 150); preparedLoads(standby()); at(active(), 192); resumes(standby()); finishRamp(); };
  const mirror = () => m.mock.getState();
  const nowTitle = () => mirror().currentTrack?.title ?? null;
  const queueTitles = () => (mirror().playNextQueue ?? []).map((q) => q.title).join(",");
  const lastPrepared = () => { const l = calls.filter((c) => c.includes(":prepare:")).pop(); return l ? l.slice(l.indexOf("https")) : null; };
  return { orch, o, calls, mgr, toMain, deck, active, standby, at, startPlaying, preparedLoads, resumes, mixThrough, finishRamp, mirror, nowTitle, queueTitles, lastPrepared };
}
setUrlPlaybackPrefs({ autoMix: true, repeatMode: "playlist" });

// ── what a drop adds ──
assert("Q1 dropped URL → 1 item", buildQueueItems(dropUrl(1)).length === 1);
assert("Q2 dropped playlist → ALL its tracks in order", buildQueueItems(dropPlaylist).map((t) => t.url).join() === [10, 11, 12].map(qUrl).join());
assert("Q3 dropped single LEAF of a playlist → only that track (never its whole playlist)", buildQueueItems({ source: { ...payload(2).source } }).length === 1);
assert("Q4 LOCAL / URL-less drops are ignored (LOCAL files never reach MAIN)", buildQueueItems({ source: { id: "x", type: "local", url: "C:\\a.mp3" } }).length === 0);

// ── URL session: the dropped item plays next, then the playlist resumes exactly where it stopped ──
{
  const w = world();
  w.toMain("PLAY_SOURCE", payload(0)); w.startPlaying(w.active());
  w.toMain("QUEUE_NEXT", dropUrl(1));
  assert("U1 drop while Track 0 plays → queued (visible to every controller)", w.queueTitles() === "Dropped 1" && w.nowTitle() === "Track 0");
  w.at(w.active(), 150);
  assert("U2 ~60 s before the end the QUEUED item is prepared (not Track 1)", w.lastPrepared() === qUrl(1));
  w.preparedLoads(w.standby()); w.at(w.active(), 192); w.resumes(w.standby()); w.finishRamp();
  assert("U3 at the mix point the queued item takes over → now playing 'Dropped 1', queue empty", w.nowTitle() === "Dropped 1" && w.queueTitles() === "" && w.mirror().currentTrackIndex === -1);
  w.at(w.active(), 150);
  assert("U4 after the queue → Track 1 prepared (the playlist resumes exactly where it stopped)", w.lastPrepared() === urlOf(1));
  w.preparedLoads(w.standby()); w.at(w.active(), 192); w.resumes(w.standby()); w.finishRamp();
  assert("U5 … and plays Track 1", w.nowTitle() === "Track 1" && w.mirror().currentTrackIndex === 1);
  w.orch.kill();
}
// ── a dropped playlist plays in order, then the playlist resumes ──
{
  const w = world();
  w.toMain("PLAY_SOURCE", payload(2)); w.startPlaying(w.active());
  w.toMain("QUEUE_NEXT", dropPlaylist);
  assert("P1 dropped playlist → Q10,Q11,Q12 queued in order", w.queueTitles() === "Q10,Q11,Q12");
  const seen: string[] = [];
  for (let k = 0; k < 4; k++) { w.mixThrough(); seen.push(w.nowTitle() ?? "?"); }
  assert("P2 plays Q10 → Q11 → Q12 → then Track 3 (resume after Track 2)", seen.join(",") === "Q10,Q11,Q12,Track 3", seen.join(","));
  w.orch.kill();
}
// ── remove from the queue ──
{
  const w = world();
  w.toMain("PLAY_SOURCE", payload(0)); w.startPlaying(w.active());
  w.toMain("QUEUE_NEXT", dropUrl(1)); w.toMain("QUEUE_NEXT", dropUrl(2));
  w.at(w.active(), 150);
  const qid = (w.mirror().playNextQueue ?? [])[0]?.id;
  w.toMain("QUEUE_REMOVE", { queueItemId: qid });
  w.at(w.active(), 151);
  assert("R1 removing the prepared head → it is dropped and the next queued item is prepared instead", w.queueTitles() === "Dropped 2" && w.lastPrepared() === qUrl(2));
  w.orch.kill();
}
// ── NEXT / PREV in MAIN (queue first; one navigation at a time) ──
{
  const w = world();
  w.toMain("PLAY_SOURCE", payload(1)); w.startPlaying(w.active());
  w.toMain("QUEUE_NEXT", dropUrl(5));
  w.toMain("NEXT");
  assert("N1 NEXT with a queued item → the queued item loads (MAIN), crossfading over the audible track", w.calls.some((c) => c.includes(`:play:${qUrl(5)}`)) && w.nowTitle() === "Dropped 5");
  const loads = w.calls.filter((c) => c.includes(":play:")).length;
  for (let k = 0; k < 10; k++) w.toMain("NEXT");
  assert("N2 10× NEXT while that load is pending → ignored (one navigation)", w.calls.filter((c) => c.includes(":play:")).length === loads);
  w.startPlaying(w.standby()); w.finishRamp(); // the queued item becomes the playing one
  w.toMain("PREV");
  assert("N3 PREV from a queued item → the playlist item it interrupted (Track 1)", w.calls.some((c) => c.includes(`:play:${urlOf(1)}`)) && w.nowTitle() === "Track 1");
  w.orch.kill();
}
// ── a MAIN NEXT whose load fails → the audible track + its title stay (Gate 2a / 1f), the session rolls back ──
{
  const w = world();
  w.toMain("PLAY_SOURCE", payload(1)); w.startPlaying(w.active());
  w.toMain("QUEUE_NEXT", dropUrl(6));
  w.toMain("NEXT");
  w.standby().handleEvent({ event: "start-file" }); w.standby().handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" });
  const aud = w.o.activeMusicDeck;
  assert("N4 failed NEXT (queued item) → the audible Track 1 keeps playing; the failed item leaves the queue; the following item (Track 2) is tried ONCE on standby (1b rule)",
    w.queueTitles() === "" && w.calls.some((c) => c.includes(`:play:${urlOf(2)}`)) && w.o.activeMusicDeck === aud && w.nowTitle() === "Track 2", String(w.nowTitle()));
  w.orch.kill();
}
// ── drop while nothing plays → plays now ──
{
  const w = world();
  w.toMain("QUEUE_NEXT", dropUrl(7));
  assert("I1 drop while idle → the dropped URL plays at once", w.calls.some((c) => c.includes(`:play:${qUrl(7)}`)) && w.nowTitle() === "Dropped 7");
  w.orch.kill();
}
// ── LOCAL session: the queued item plays after the current LOCAL track, then LOCAL resumes ──
{
  const w = world();
  w.orch.playMusic("C:\\music\\one.mp3", 7); w.startPlaying(w.active());
  w.toMain("PLAY_SOURCE", { source: { id: "local-pl", title: "Local", type: "local", url: "", origin: "playlist", sessionTracks: [{ id: "a", title: "L A", cover: null }, { id: "b", title: "L B", cover: null }] }, trackIndex: 0 });
  w.toMain("QUEUE_NEXT", dropUrl(3));
  w.at(w.active(), 100);
  assert("L1 MAIN watches the LOCAL track (the renderer's automatic advance yields its slot)", w.mgr.snapshot().queueWatchesLocal === true);
  w.at(w.active(), 150);
  assert("L2 ~60 s before the LOCAL end the queued URL is prepared", w.lastPrepared() === qUrl(3));
  w.preparedLoads(w.standby()); w.at(w.active(), 192); w.resumes(w.standby());
  const snap = w.mgr.snapshot();
  assert("L3 at the mix point the queued URL plays; the queue is empty → the renderer must take the slot back", snap.mainQueuePlaying === true && snap.queueReturnToLocal === true && w.nowTitle() === "Dropped 3");
  // the renderer resumes LOCAL (its engine loads the next LOCAL file through the existing crossfade path)
  w.orch.playMusicCrossfade("C:\\music\\two.mp3", 9, 8); w.startPlaying(w.standby()); w.resumes(w.standby());
  const s2 = w.mgr.snapshot();
  assert("L4 the renderer's next LOCAL track plays → MAIN releases the queue context", s2.mainQueuePlaying === false && s2.queueReturnToLocal === false && s2.queueWatchesLocal === false);
  w.orch.kill();
}

// ── static pins: renderer wiring ──
const rd = (p: string) => readFileSync(path.join(__dirname, "..", "..", p), "utf-8").replace(/\r\n/g, "\n");
const prov = rd("lib/playback-provider.tsx"), dpc = rd("lib/device-player-context.tsx"), lqp = rd("components/live-queue-panel.tsx");
assert("S1 provider: an AUTOMATIC advance yields to MAIN's queue (manual NEXT / PREV unaffected)", /if \(auditTransportCase === "ended_auto" && autoAdvanceHandoff\.current\?\.\(\)\) return;/.test(prov));
assert("S2 renderer: yields while MAIN watches / plays the queue; takes the slot back after it (provider next)",
  /autoAdvanceHandoff\.current = \(\) =>/.test(dpc) && /s\?\.queueWatchesLocal === true \|\| s\?\.mainQueuePlaying === true/.test(dpc) && /const returnToLocal = useCallback\(\(reason: string\) => \{[\s\S]*?localSessionOwnedRef\.current = true;[\s\S]*?next\(\);/.test(dpc));
assert("S3 station NEXT / PREV go to MAIN while it owns the URL / queued item", (dpc.match(/else if \(mainOwnsNav\(\)\) sendRemoteNav\("(NEXT|PREV)"\);/g) ?? []).length === 2);
assert("S4 queue panel removes from MAIN's queue on a CONTROL mirror", /if \(isControlMirror && deviceCtx\?\.removeQueueNextOrSend\) deviceCtx\.removeQueueNextOrSend\(id\);/.test(lqp));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
