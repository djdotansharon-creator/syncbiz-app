/**
 * P0 Gate 1b + 1c (2026-10-07) — URL failure → ONE safe session step; ONE transition intent for EVERY controller.
 * Drives the REAL PlaybackOrchestrator + DeviceWsManager (synthetic MPV IPC events, no MPV process) through the REAL
 * pure intent module (lib/url-transition-intent.ts). The station controller below mirrors lib/device-player-context.tsx
 * (playSourceOrSend / stepUrlSession / observeUrlTransition / transport guards) — pinned statically at the end so the
 * mirror cannot drift; the remote controller mirrors lib/station-controller-context.tsx.
 * Run (from desktop/): npx tsx scripts/verify-gate1bc-transition-intent.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager } from "../src/device-websocket-client/device-ws-manager";
import {
  MAX_CONSECUTIVE_FAILURES, beginTransition, decideUserCommand, failTransition, isBlocking, observeTransition,
  targetKeyOf, tickTransition, transitionLabel, type TransitionObservation, type TransitionOrigin, type UrlTransition,
} from "../../lib/url-transition-intent";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void; stop: () => void; setVolume: (v: number) => void; pause: () => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; activeMusicDeck: "A" | "B"; currentAttemptDeck: "A" | "B"; musicStA: { status: string }; musicStB: { status: string } };
const LOCAL = "C:\\music\\one.mp3";
const urlOf = (i: number) => `https://www.youtube.com/watch?v=item${String(i).padStart(7, "0")}`;

/** MAIN + a station controller (co-located renderer) + a remote controller (phone / browser), one WS command bus. */
function world(sessionLen: number) {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const calls: string[] = [];
  const observers: Array<() => void> = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    const pl = d.play.bind(d), st = d.stop.bind(d), sv = d.setVolume.bind(d), pa = d.pause.bind(d);
    d.play = (u, a) => { calls.push(`${id}:play:${u}`); pl(u, a); };
    d.stop = () => { calls.push(`${id}:stop`); st(); };
    d.setVolume = (v) => { calls.push(`${id}:vol=${v}`); sv(v); };
    d.pause = () => { calls.push(`${id}:pause`); pa(); };
    // every MPV event → MAIN status → each controller observes it (desktop onStatus IPC / mirrored STATE_UPDATE)
    const he = d.handleEvent.bind(d);
    d.handleEvent = (m) => { he(m); drainPushes(); };
  }
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  // Updated 2026-10-08 (P0 Gate 2a): controllers observe EVERY MAIN status push in order (exactly as IPC / WS STATE_UPDATE
  // deliver them — one deep-copied snapshot per push) instead of sampling live state after an MPV event. MAIN now
  // pushes a failed standby ONCE and then the still-audible deck (Gate 2a item 3); assertions unchanged.
  type Snap = ReturnType<typeof mgr.snapshot>;
  const pushes: Array<{ snap: Snap; mirror: unknown }> = [];
  let tap: { snap: Snap; mirror: unknown } | null = null;
  {
    const mm = mgr as unknown as { push: () => void; snapshot: () => Snap; mock: { getState: () => unknown } };
    const origPush = mm.push.bind(mgr), origSnap = mm.snapshot.bind(mgr);
    mm.push = () => { const t = tap; tap = null; pushes.push({ snap: origSnap(), mirror: JSON.parse(JSON.stringify(mm.mock.getState())) }); origPush(); tap = t; };
    mm.snapshot = () => (tap ? tap.snap : origSnap());
  }
  const drainPushes = () => { while (pushes.length) { tap = pushes.shift()!; for (const f of observers) f(); } tap = null; };
  const wsCmds: string[] = [];
  const toMain = (cmd: string, payload?: unknown) => {
    wsCmds.push(cmd);
    (mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void }).runTransportCommand(cmd, payload, "ws");
  };
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const cur = () => deck(o.currentAttemptDeck);
  const urlLoads = () => calls.filter((c) => /:play:https/.test(c)).length;
  const items = Array.from({ length: sessionLen }, (_, i) => ({ id: "pl", url: urlOf(i), trackIndex: i }));
  // real playlist payloads carry the full track snapshot (lib/remote-control/source-to-payload.ts) → MAIN mirrors trackIndex
  const sessionTracks = items.map((it, i) => ({ id: `t${i}`, title: `item ${i}`, cover: null, url: it.url }));
  const payload = (i: number) => ({ source: { id: "pl", title: `item ${i}`, url: items[i].url, type: "youtube", origin: "playlist", playlistId: "pl", sessionTracks }, trackIndex: i });

  // ── station controller (mirror of lib/device-player-context.tsx) ──
  const station = {
    t: null as UrlTransition | null,
    sentIdx: null as number | null,
    log: [] as string[],
    snap(): { attemptId: number; status: string } {
      const s = mgr.snapshot();
      return { attemptId: s.mpvAttemptId, status: s.mockPlaybackStatus };
    },
    begin(origin: TransitionOrigin, key: string | null, failures = 0) {
      const sn = this.snap();
      this.t = beginTransition({ origin, targetKey: key, now: Date.now(), priorAttemptId: sn.attemptId, audibleAtStart: sn.status === "playing" || this.audible(), consecutiveFailures: failures });
    },
    audible: () => o.musicStA.status === "playing" || o.musicStB.status === "playing",
    select(i: number) {
      const key = targetKeyOf("pl", i);
      if (decideUserCommand(this.t, { kind: "select", targetKey: key }) !== "accept") return;
      this.begin("select", key);
      this.sentIdx = i;
      toMain("PLAY_SOURCE", payload(i));
    },
    step(dir: "next" | "prev", opts?: { noWrap?: boolean; origin?: TransitionOrigin; failures?: number }): boolean {
      if (this.sentIdx === null) return false;
      let n = this.sentIdx + (dir === "next" ? 1 : -1);
      if (n >= items.length || n < 0) { if (opts?.noWrap) return false; n = (n + items.length) % items.length; }
      this.sentIdx = n;
      this.begin(opts?.origin ?? (opts?.noWrap ? "auto-eof" : dir), targetKeyOf("pl", n), opts?.failures ?? 0);
      toMain("PLAY_SOURCE", payload(n));
      return true;
    },
    next() { if (isBlocking(this.t)) return; if (!this.step("next")) toMain("NEXT"); },
    play() { if (decideUserCommand(this.t, { kind: "play" }) !== "accept") return; toMain("PLAY"); },
    pause() { this.t = null; toMain("PAUSE"); },
    stop() { this.t = null; toMain("STOP"); },
    selectLocal() { this.t = null; this.sentIdx = null; orch.playMusic(LOCAL, 7); },
    /** desktop onStatus → observeUrlTransition(…, true) */
    observe() {
      if (!tap && pushes.length) drainPushes(); // strict push order (a manual observe never jumps queued pushes)
      if (!this.t) return;
      const s = mgr.snapshot();
      const ob: TransitionObservation = { attemptId: s.mpvAttemptId, sourceId: null, trackIndex: null, status: s.mockPlaybackStatus, position: s.mpvPosition, error: s.mpvLastError || null, engineReady: s.mpvEngineReady !== false };
      const res = observeTransition(this.t, ob);
      if (res.event === "confirmed") { this.t = res.t; return; }
      if (res.event !== "failed" || !res.t) { this.t = res.t; return; }
      const failures = (res.t.phase === "confirmed" ? 0 : res.t.consecutiveFailures) + 1;
      const before = this.t;
      const stepped = failures < MAX_CONSECUTIVE_FAILURES && this.step("next", { noWrap: true, origin: "auto-failure", failures });
      const sent = stepped && this.t !== before;
      this.log.push(sent ? "stepped" : "kept");
      if (!sent) this.t = failTransition(res.t, Date.now());
    },
  };

  // ── remote controller (mirror of lib/station-controller-context.tsx) ──
  const remote = {
    t: null as UrlTransition | null,
    sendPlaySource(i: number) {
      const key = targetKeyOf("pl", i);
      if (decideUserCommand(this.t, { kind: "select", targetKey: key }) !== "accept") return;
      this.t = beginTransition({ origin: "select", targetKey: key, now: Date.now(), priorAttemptId: null, audibleAtStart: station.audible() });
      toMain("PLAY_SOURCE", payload(i));
    },
    sendPlay() { if (decideUserCommand(this.t, { kind: "play" }) !== "accept") return; toMain("PLAY"); },
    sendNext() { if (isBlocking(this.t)) return; toMain("NEXT"); },
    sendStop() { this.t = null; toMain("STOP"); },
    /** mirrored STATE_UPDATE (source id / track index from MAIN's published session) */
    observe() {
      if (!tap && pushes.length) drainPushes(); // strict push order (a manual observe never jumps queued pushes)
      if (!this.t) return;
      const s = mgr.snapshot();
      type MS = { currentSource?: { id?: string } | null; currentTrackIndex?: number };
      const ms = (tap ? tap.mirror : (mgr as unknown as { mock: { getState: () => MS } }).mock.getState()) as MS;
      const res = observeTransition(this.t, { attemptId: null, sourceId: ms.currentSource?.id ?? null, trackIndex: typeof ms.currentTrackIndex === "number" ? ms.currentTrackIndex : null, status: s.mockPlaybackStatus, position: s.mpvPosition, error: s.mpvLastError || null, engineReady: s.mpvEngineReady !== false });
      if (res.event === "confirmed") this.t = null;
      else if (res.event === "failed" && res.t) this.t = failTransition(res.t, Date.now());
      else this.t = res.t;
    },
  };

  observers.push(() => station.observe(), () => remote.observe());
  const playingEvents = (d: Deck, dur = 200) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); d.handleEvent({ event: "property-change", name: "time-pos", data: 1 }); d.handleEvent({ event: "property-change", name: "time-pos", data: 2 }); };
  const failAtZero = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 225 }); d.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" }); };
  /** an audible starting point: LOCAL on deck A (renderer attempt 7) */
  const audibleLocal = () => { orch.playMusic(LOCAL, 7); playingEvents(deck("A")); };
  const aTouched = (since: number) => calls.slice(since).filter((c) => c.startsWith("A:") && c !== "A:vol=80");
  return { orch, o, calls, wsCmds, deck, cur, urlLoads, station, remote, playingEvents, failAtZero, audibleLocal, aTouched };
}

// 1. 10× same URL from the STATION → 1 send, 1 MAIN load, "Loading…" immediately
{
  const w = world(5);
  w.audibleLocal();
  for (let i = 0; i < 10; i++) w.station.select(2);
  assert("T1 10× same URL (station) → 1 PLAY_SOURCE sent, 1 effective MAIN load, label Loading…",
    w.wsCmds.filter((c) => c === "PLAY_SOURCE").length === 1 && w.urlLoads() === 1 && transitionLabel(w.station.t) === "Loading…");
  w.orch.kill();
}
// 2. 10× same URL from a REMOTE (browser / phone) → 1 send, 1 load
{
  const w = world(5);
  w.audibleLocal();
  for (let i = 0; i < 10; i++) w.remote.sendPlaySource(2);
  assert("T2 10× same URL (browser/phone) → 1 PLAY_SOURCE sent, 1 effective MAIN load, label Loading…",
    w.wsCmds.filter((c) => c === "PLAY_SOURCE").length === 1 && w.urlLoads() === 1 && transitionLabel(w.remote.t) === "Loading…");
  // even if a legacy page bypasses the guard, MAIN still de-duplicates (Gate 1a defence in depth)
  w.remote.t = null; for (let i = 0; i < 9; i++) w.remote.sendPlaySource(2);
  assert("T2b guard bypassed (legacy page) → MAIN still 1 effective load", w.urlLoads() === 1);
  w.orch.kill();
}
// 3. PLAY spam while pending → 0 sent from controllers, 0 reloads on MAIN
{
  const w = world(5);
  w.audibleLocal();
  w.station.select(1);
  const loads = w.urlLoads();
  for (let i = 0; i < 10; i++) { w.station.play(); w.remote.sendPlay(); }
  assert("T3 10× PLAY (station + remote) while pending → 0 PLAY sent by the station, 0 MAIN reloads", w.wsCmds.filter((c) => c === "PLAY").length === 10 /* remote had no intent */ && w.urlLoads() === loads);
  w.remote.t = w.station.t; const sent = w.wsCmds.length;
  for (let i = 0; i < 10; i++) w.remote.sendPlay();
  assert("T3b remote with a pending intent → 0 PLAY sent", w.wsCmds.length === sent);
  w.orch.kill();
}
// 4. 10× NEXT → exactly one step
{
  const w = world(20);
  w.audibleLocal();
  w.station.select(0); w.playingEvents(w.cur()); w.station.observe();
  assert("T4a attempt with advancing position → confirmed (not blocking)", w.station.t?.phase === "confirmed" && !isBlocking(w.station.t));
  for (let i = 0; i < 10; i++) w.station.next();
  assert("T4 10× NEXT → exactly 1 step (item 0 → 1)", w.station.sentIdx === 1 && w.wsCmds.filter((c) => c === "PLAY_SOURCE").length === 2);
  const w2 = world(5); w2.remote.sendPlaySource(0);
  for (let i = 0; i < 10; i++) w2.remote.sendNext();
  assert("T4b remote 10× NEXT while pending → 0 NEXT sent", w2.wsCmds.filter((c) => c === "NEXT").length === 0);
  w.orch.kill(); w2.orch.kill();
}
// 5. a different URL wins
{
  const w = world(5);
  w.audibleLocal();
  w.station.select(1); w.station.select(3);
  assert("T5 different URL during pending → accepted, newest target is the intent", w.station.t?.targetKey === "pl#3" && w.urlLoads() === 2);
  w.orch.kill();
}
// 6. STOP / PAUSE always allowed
{
  const w = world(5);
  w.audibleLocal();
  w.station.select(1); w.station.stop();
  assert("T6 STOP during pending → sent, intent cleared, decks stopped", w.station.t === null && w.wsCmds.includes("STOP") && w.calls.includes("A:stop"));
  w.station.select(2); w.station.pause();
  assert("T6b PAUSE during pending → sent, intent cleared", w.station.t === null && w.wsCmds.includes("PAUSE"));
  w.orch.kill();
}
// 7 + 8. failed standby with a next item → old audio continues; exactly ONE step
{
  const w = world(5);
  w.audibleLocal();
  w.station.select(1);
  w.station.observe(); // bind to the new MAIN attempt
  const mark = w.calls.length;
  w.failAtZero(w.cur());
  for (let i = 0; i < 5; i++) w.station.observe(); // repeated failure snapshots
  assert("T7 failed standby (pos 0) → audible deck A never stopped / lowered, still playing", w.aTouched(mark).length === 0 && w.o.musicStA.status === "playing");
  assert("T8 failed URL with a next item → exactly ONE step (1 → 2), label 'trying next'", w.station.log.join(",") === "stepped" && w.station.sentIdx === 2 && transitionLabel(w.station.t) === "Couldn't play — trying next…", w.station.log.join(","));
  // next item also fails, then a third → consecutive cap (3) → kept
  w.station.observe(); w.failAtZero(w.cur()); for (let i = 0; i < 3; i++) w.station.observe();
  w.station.observe(); w.failAtZero(w.cur()); for (let i = 0; i < 3; i++) w.station.observe();
  assert("T8b consecutive failures capped at 3 → stop stepping, 'current music kept', A still audible",
    w.station.log.join(",") === "stepped,stepped,kept" && w.station.t?.phase === "failed-kept" && w.o.musicStA.status === "playing" && transitionLabel(w.station.t) === "Couldn't play — current music kept", w.station.log.join(","));
  w.orch.kill();
}
// 9. failed URL with NO next item → old audio remains, message only
{
  const w = world(2);
  w.audibleLocal();
  w.station.select(1); w.station.observe();
  const mark = w.calls.length;
  w.failAtZero(w.cur()); w.station.observe(); w.station.observe();
  assert("T9 failed URL at the last item → no step, 'current music kept', A audible", w.station.log.join(",") === "kept" && w.station.t?.phase === "failed-kept" && w.aTouched(mark).length === 0 && w.o.musicStA.status === "playing");
  w.orch.kill();
}
// 10. cold-start failure (nothing audible) → idle + visible error, NO LOCAL fallback
{
  const w = world(1);
  w.station.select(0); w.station.observe();
  w.failAtZero(w.cur()); w.station.observe();
  assert("T10 cold-start failure → failed-idle + 'Couldn't play this URL', no LOCAL load", w.station.t?.phase === "failed-idle" && transitionLabel(w.station.t) === "Couldn't play this URL" && !w.calls.some((c) => c.includes(LOCAL)));
  const later = tickTransition(w.station.t, Date.now() + 7000, true);
  assert("T10b the message expires (no stuck error state)", later === null);
  w.orch.kill();
}
// 11/12. EOF of a confirmed attempt is NOT a transition failure (url-eof owns natural / premature EOF, unchanged)
{
  const w = world(5);
  w.station.select(0); w.station.observe(); w.playingEvents(w.cur()); w.station.observe();
  w.cur().handleEvent({ event: "end-file", reason: "eof" }); w.station.observe();
  assert("T11 natural EOF of a confirmed attempt → no failure step (url-eof path owns it)", w.station.log.length === 0 && w.station.t?.phase === "confirmed");
  w.orch.kill();
}
// 13. LOCAL selection clears the URL intent via the existing LOCAL path
{
  const w = world(5);
  w.audibleLocal(); w.station.select(1); w.station.selectLocal();
  assert("T13 explicit LOCAL during pending → URL intent cleared (existing LOCAL path)", w.station.t === null);
  w.orch.kill();
}
// 17. remote observation follows the mirrored session (bind → confirm / fail)
{
  const w = world(5);
  w.remote.sendPlaySource(1); w.remote.observe();
  w.playingEvents(w.cur()); w.remote.observe(); w.remote.observe();
  (w.cur() as Deck).handleEvent({ event: "property-change", name: "time-pos", data: 3 }); w.remote.observe();
  assert("T17a remote: bound on mirrored source/track, confirmed on advancing position → intent cleared", w.remote.t === null);
  const w2 = world(5);
  w2.remote.sendPlaySource(1); w2.remote.observe(); w2.failAtZero(w2.cur()); w2.remote.observe();
  assert("T17b remote: failure → visible message, no step from the remote (session owner steps)", w2.remote.t?.phase === "failed-idle" && w2.wsCmds.filter((c) => c === "NEXT").length === 0);
  w.orch.kill(); w2.orch.kill();
}

// ── static pins: the mirrors above match the shipped controller layers ──
const root = path.join(__dirname, "..", "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
const dpc = rd("lib/device-player-context.tsx");
const scc = rd("lib/station-controller-context.tsx");
const ap = rd("components/audio-player.tsx");
const mpc = rd("components/mobile/mobile-player-core.tsx");
const obs = dpc.slice(dpc.indexOf("const observeUrlTransition = useCallback"), dpc.indexOf("const observeUrlTransitionRef"));
assert("S1 device-player-context: URL select guarded by decideUserCommand + begins the transition before sending",
  /decideUserCommand\(urlTransitionRef\.current, \{ kind: "select", targetKey: selectKey \}\)/.test(dpc) && dpc.indexOf('beginUrlTransition("select", selectKey)') < dpc.indexOf('sendCommandToMaster("PLAY_SOURCE", {\n          source: unifiedSourceToPayload(source)'));
assert("S2 device-player-context: PLAY guarded, NEXT/PREV ignored while pending, PAUSE/STOP clear first",
  /decideUserCommand\(urlTransitionRef\.current, \{ kind: "play" \}\)/.test(dpc) && (dpc.match(/else if \(transitionPending\(\)\)/g) ?? []).length === 2 &&
  /const pauseOrSend = useCallback\(\(\) => \{\n    setUrlTransition\(null\);/.test(dpc) && /const stopOrSend = useCallback\(\(\) => \{\n    setUrlTransition\(null\);/.test(dpc));
// Updated 2026-10-08 (P0 Gate 2a): the failure step is \`automatic: "failure"\` (follows loop; never retries the failing item).
assert("S3 device-player-context: failure → ONE automatic auto-failure step, capped, never a LOCAL fallback",
  /failures < MAX_CONSECUTIVE_FAILURES/.test(obs) && /stepUrlSessionRef\.current\("next", \{ automatic: "failure", origin: "auto-failure", failures \}\)/.test(obs) && !/playSource\(|playMusic|type === "local"/.test(obs) && /if \(!station\) \{ setUrlTransition\(failTransition/.test(obs));
assert("S4 device-player-context: LOCAL selections clear the URL intent", (dpc.match(/setUrlTransition\(null\); \/\/ P0 Gate 1c: (an )?explicit LOCAL/g) ?? []).length === 2);
assert("S5 station-controller-context: select / PLAY / NEXT / PREV guarded, PAUSE / STOP clear",
  /decideUserCommand\(transitionRef\.current, \{ kind: "select", targetKey: key \}\)/.test(scc) && /decideUserCommand\(transitionRef\.current, \{ kind: "play" \}\)/.test(scc) &&
  (scc.match(/if \(isBlocking\(transitionRef\.current\)\) return;/g) ?? []).length === 2 && (scc.match(/setTransition\(null\); \/\/ always allowed/g) ?? []).length === 2);
assert("S6 UI: station/web player + phone show the transition label; audible item held while loading",
  /transitionLabel\(/.test(ap) && /urlTransitionHeldState/.test(ap) && /transitionLabel\(/.test(mpc) && /isBlocking\(/.test(mpc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
