/**
 * P0 Gate 1d (2026-10-08) — remote NEXT / PREV = the SAME real playback step as the station; mirrored attempt id.
 * REAL PlaybackOrchestrator + REAL DeviceWsManager (WS NEXT/PREV → handleRemoteStep → status snapshot) + the REAL pure
 * intent module. The station consumer below mirrors lib/device-player-context.tsx (relay baseline / exactly-once by
 * (sessionStepBootId, sessionStepSeq) → relayedStep → stepUrlSession); browser / phone mirror the remote observers
 * (mode "remote", mirrored mpvAttemptId). Static pins at the end keep the mirrors honest.
 * Run (from desktop/): npx tsx scripts/verify-gate1d-remote-step-relay.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager } from "../src/device-websocket-client/device-ws-manager";
import type { MvpStatusSnapshot } from "../src/shared/mvp-types";
import {
  MAX_CONSECUTIVE_FAILURES, beginTransition, decideUserCommand, failTransition, isBlocking, observeTransition,
  targetKeyOf, type TransitionOrigin, type UrlTransition,
} from "../../lib/url-transition-intent";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void; stop: () => void; setVolume: (v: number) => void; pause: () => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; currentAttemptDeck: "A" | "B"; musicStA: { status: string }; musicStB: { status: string } };
type Mirror = { currentSource?: { id?: string } | null; currentTrackIndex?: number; status: string; position?: number; mpvAttemptId?: number; mpvEngineError?: string | null; mpvEngineReady?: boolean };
const urlOf = (i: number) => `https://www.youtube.com/watch?v=item${String(i).padStart(7, "0")}`;

function world(sessionLen: number, opts: { withStation?: boolean } = {}) {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const calls: string[] = [];
  const observers: Array<() => void> = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    const pl = d.play.bind(d), st = d.stop.bind(d), sv = d.setVolume.bind(d), pa = d.pause.bind(d), he = d.handleEvent.bind(d);
    d.play = (u, a) => { calls.push(`${id}:play:${u}`); pl(u, a); };
    d.stop = () => { calls.push(`${id}:stop`); st(); };
    d.setVolume = (v) => { calls.push(`${id}:vol=${v}`); sv(v); };
    d.pause = () => { calls.push(`${id}:pause`); pa(); };
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
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void; handleRemoteStep: (c: "NEXT" | "PREV") => void; push: () => void; mock: { getState: () => Mirror } };
  const wsCmds: string[] = [];
  /** the WS COMMAND handler (MASTER): NEXT/PREV → handleRemoteStep; else runTransportCommand; then push() */
  const toMain = (cmd: string, payload?: unknown) => {
    wsCmds.push(cmd);
    if (cmd === "NEXT" || cmd === "PREV") m.handleRemoteStep(cmd); else m.runTransportCommand(cmd, payload, "ws");
    m.push();
  };
  const mirror = () => (tap ? tap.mirror : m.mock.getState()) as Mirror;
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const cur = () => deck(o.currentAttemptDeck);
  const urlLoads = () => calls.filter((c) => /:play:https/.test(c)).length;
  const lastLoadedUrl = () => { const l = calls.filter((c) => /:play:https/.test(c)).pop(); return l ? l.slice(l.indexOf("https")) : null; };
  const sessionTracks = Array.from({ length: sessionLen }, (_, i) => ({ id: `t${i}`, title: `item ${i}`, cover: null, url: urlOf(i) }));
  const payload = (i: number) => ({ source: { id: "pl", title: `item ${i}`, url: urlOf(i), type: "youtube", origin: "playlist", playlistId: "pl", sessionTracks }, trackIndex: i });

  // ── station renderer (mirror of lib/device-player-context.tsx) ──
  const station = {
    t: null as UrlTransition | null,
    sentIdx: null as number | null,
    consumed: null as { boot: string; seq: number } | null,
    relayLog: [] as string[],
    log: [] as string[],
    begin(origin: TransitionOrigin, key: string | null, failures = 0) {
      const s = mgr.snapshot();
      this.t = beginTransition({ origin, targetKey: key, now: Date.now(), priorAttemptId: s.mpvAttemptId, audibleAtStart: s.mockPlaybackStatus === "playing", consecutiveFailures: failures });
    },
    select(i: number) {
      const key = targetKeyOf("pl", i);
      if (decideUserCommand(this.t, { kind: "select", targetKey: key }) !== "accept") return;
      this.begin("select", key); this.sentIdx = i; toMain("PLAY_SOURCE", payload(i));
    },
    step(dir: "next" | "prev", o2?: { noWrap?: boolean; origin?: TransitionOrigin; failures?: number }): boolean {
      if (this.sentIdx === null) return false;
      let n = this.sentIdx + (dir === "next" ? 1 : -1);
      if (n >= sessionLen || n < 0) { if (o2?.noWrap) return false; n = (n + sessionLen) % sessionLen; }
      this.sentIdx = n;
      this.begin(o2?.origin ?? (o2?.noWrap ? "auto-eof" : dir), targetKeyOf("pl", n), o2?.failures ?? 0);
      toMain("PLAY_SOURCE", payload(n));
      return true;
    },
    /** station UI NEXT / PREV (nextOrSend) */
    nav(dir: "next" | "prev") { if (isBlocking(this.t)) return; if (!this.step(dir)) toMain(dir === "next" ? "NEXT" : "PREV"); },
    /** relayedStep — same path, never sends NEXT/PREV back to MAIN */
    relayed(dir: "next" | "prev", seq: number) {
      const r = isBlocking(this.t) ? "ignored-pending" : this.step(dir) ? "url-step" : "no-step";
      this.relayLog.push(`#${seq}:${r}`);
    },
    /** desktop onStatus: relay consumer (baseline + exactly-once) */
    onSnapshot(s: MvpStatusSnapshot) {
      const boot = s.sessionStepBootId ?? null, seq = s.sessionStepSeq ?? null;
      if (boot === null || seq === null) return;
      const last = this.consumed;
      this.consumed = { boot, seq: Math.max(seq, last && last.boot === boot ? last.seq : 0) };
      if (last && last.boot === boot && seq > last.seq && (s.sessionStepDirection === "next" || s.sessionStepDirection === "prev")) this.relayed(s.sessionStepDirection, seq);
    },
    observe() {
      if (!tap && pushes.length) drainPushes(); // strict push order (a manual observe never jumps queued pushes)
      if (!this.t) return;
      const s = mgr.snapshot();
      const res = observeTransition(this.t, { mode: "station", attemptId: s.mpvAttemptId, sourceId: null, trackIndex: null, status: s.mockPlaybackStatus, position: s.mpvPosition, error: s.mpvLastError || null, engineReady: s.mpvEngineReady !== false });
      if (res.event !== "failed" || !res.t) { this.t = res.t; return; }
      const failures = (res.t.phase === "confirmed" ? 0 : res.t.consecutiveFailures) + 1;
      const before = this.t;
      const sent = failures < MAX_CONSECUTIVE_FAILURES && this.step("next", { noWrap: true, origin: "auto-failure", failures }) && this.t !== before;
      this.log.push(sent ? "stepped" : "kept");
      if (!sent) this.t = failTransition(res.t, Date.now());
    },
  };

  // ── remote controllers: browser (DevicePlayerContext remote) / phone (StationControllerContext) ──
  const makeRemote = (kind: "browser" | "phone") => ({
    t: null as UrlTransition | null,
    events: [] as string[],
    select(i: number) {
      const key = targetKeyOf("pl", kind === "phone" ? 0 : i);
      if (decideUserCommand(this.t, { kind: "select", targetKey: key }) !== "accept") return;
      this.t = beginTransition({ origin: "select", targetKey: key, now: Date.now(), priorAttemptId: mirror().mpvAttemptId ?? null, audibleAtStart: mirror().status === "playing" });
      toMain("PLAY_SOURCE", kind === "phone" ? { source: payload(i).source } : payload(i));
    },
    nav(dir: "next" | "prev") {
      if (isBlocking(this.t)) return;
      const prior = mirror().mpvAttemptId;
      if (typeof prior === "number") this.t = beginTransition({ origin: dir, targetKey: null, now: Date.now(), priorAttemptId: prior, audibleAtStart: mirror().status === "playing" });
      toMain(dir === "next" ? "NEXT" : "PREV");
    },
    observe() {
      if (!tap && pushes.length) drainPushes(); // strict push order (a manual observe never jumps queued pushes)
      if (!this.t) return;
      const ms = mirror();
      const res = observeTransition(this.t, { mode: "remote", attemptId: typeof ms.mpvAttemptId === "number" ? ms.mpvAttemptId : null, sourceId: ms.currentSource?.id ?? null, trackIndex: typeof ms.currentTrackIndex === "number" ? ms.currentTrackIndex : null, status: ms.status, position: ms.position ?? 0, error: ms.mpvEngineError ?? null, engineReady: ms.mpvEngineReady !== false });
      if (res.event !== "none") this.events.push(res.event === "bound" ? `bound:${res.t?.boundAttemptId}` : res.event);
      if (res.event === "confirmed") this.t = null;
      else if (res.event === "failed" && res.t) this.t = failTransition(res.t, Date.now());
      else this.t = res.t;
    },
  });
  const browser = makeRemote("browser");
  const phone = makeRemote("phone");

  // status stream: every MAIN push → station relay consumer (if a station renderer is running); re-entrancy queued
  let delivering = false; const queue: MvpStatusSnapshot[] = [];
  const withStation = opts.withStation !== false;
  mgr.onStatus((s) => {
    if (!withStation) return;
    queue.push(s); if (delivering) return;
    delivering = true; while (queue.length) station.onSnapshot(queue.shift()!); delivering = false;
  });
  observers.push(() => station.observe(), () => browser.observe(), () => phone.observe());
  /** mirrored STATE_UPDATE delivery for remotes on non-deck changes (session metadata / new attempt) */
  const sync = () => { station.observe(); browser.observe(); phone.observe(); };
  const play = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 200 }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); d.handleEvent({ event: "property-change", name: "time-pos", data: 1 }); d.handleEvent({ event: "property-change", name: "time-pos", data: 2 }); };
  const failAtZero = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 225 }); d.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" }); };
  /** start: station plays item `i` of the URL session, confirmed */
  const startAt = (i: number) => { station.consumed = null; m.push(); station.select(i); play(cur()); sync(); };
  const mirrorKey = () => targetKeyOf(mirror().currentSource?.id ?? null, mirror().currentTrackIndex ?? null);
  return { orch, o, mgr, m, calls, wsCmds, cur, urlLoads, lastLoadedUrl, station, browser, phone, sync, play, failAtZero, startAt, mirror, mirrorKey };
}
type W = ReturnType<typeof world>;
const psCount = (w: W) => w.wsCmds.filter((c) => c === "PLAY_SOURCE").length;
/** one real playback transition: exactly +1 PLAY_SOURCE, +1 URL load of item `want`, mirror == audio, confirmed */
function oneTransition(w: W, before: { ps: number; loads: number }, want: number): boolean {
  w.play(w.cur()); w.sync();
  return psCount(w) === before.ps + 1 && w.urlLoads() === before.loads + 1 && w.lastLoadedUrl() === urlOf(want) && w.mirrorKey() === `pl#${want}` && w.station.t?.phase === "confirmed";
}
const mark = (w: W) => ({ ps: psCount(w), loads: w.urlLoads() });

// 1–5 (+ station PREV): every controller's NEXT / PREV = one real transition
for (const [label, who, dir, from, want] of [
  ["T1 station NEXT", "station", "next", 2, 3], ["T1b station PREV", "station", "prev", 2, 1],
  ["T2 browser NEXT", "browser", "next", 2, 3], ["T4 browser PREV", "browser", "prev", 2, 1],
  ["T3 phone NEXT", "phone", "next", 2, 3], ["T5 phone PREV", "phone", "prev", 2, 1],
] as const) {
  const w = world(6);
  w.startAt(from);
  const b = mark(w);
  if (who === "station") w.station.nav(dir); else w[who].nav(dir);
  const ot = oneTransition(w, b, want);
  const remoteOk = who === "station" ? true : w[who].events.some((e) => e.startsWith("bound:")) && w[who].events.includes("confirmed") && w[who].t === null; // bound + confirmed → cleared
  assert(`${label} → one PLAY_SOURCE, one real audio transition (item ${from} → ${want}), mirror == audio`, ot && remoteOk, `${w[who === "station" ? "station" : who] === w.station ? w.station.relayLog.join(",") : w[who as "browser"].events.join(",")}`);
  w.orch.kill();
}
// 6. one relay request delivered 10× → one step
{
  const w = world(6); w.startAt(1);
  const b = mark(w);
  w.m.handleRemoteStep("NEXT");
  for (let i = 0; i < 10; i++) w.m.push(); // the SAME request identity re-delivered
  assert("T6 one relay request delivered 10× → exactly 1 step", psCount(w) === b.ps + 1 && w.station.relayLog.length === 1 && w.station.sentIdx === 2, w.station.relayLog.join(","));
  w.orch.kill();
}
// 7. renderer remount never replays an old request
{
  const w = world(6); w.startAt(1);
  w.m.handleRemoteStep("NEXT"); w.m.push(); w.play(w.cur()); w.sync(); // step #1 consumed (1 → 2)
  const b = mark(w);
  w.station.consumed = null; // remount: fresh consumer, no memory
  w.station.relayLog = [];
  for (let i = 0; i < 5; i++) w.m.push(); // MAIN still carries seq #1
  assert("T7 renderer remount: old request (seq 1) is the baseline → 0 steps", psCount(w) === b.ps && w.station.relayLog.length === 0);
  w.m.handleRemoteStep("NEXT"); w.m.push();
  assert("T7b a NEW request after remount → exactly 1 step", psCount(w) === b.ps + 1 && w.station.relayLog.join(",") === "#2:url-step");
  w.orch.kill();
}
// 8. 10 NEXT while a transition is pending → one step (controller guard AND, if bypassed, the station guard)
{
  const w = world(12); w.startAt(1);
  const b = mark(w);
  for (let i = 0; i < 10; i++) w.phone.nav("next");
  assert("T8 phone 10× NEXT while pending → 1 NEXT sent, 1 step", w.wsCmds.filter((c) => c === "NEXT").length === 1 && psCount(w) === b.ps + 1);
  const w2 = world(12); w2.startAt(1);
  const b2 = mark(w2);
  for (let i = 0; i < 10; i++) w2.m.handleRemoteStep("NEXT"), w2.m.push(); // legacy page: raw NEXT ×10, no client guard
  assert("T8b raw 10× NEXT (no client guard) → MAIN relays 10 requests, station steps ONCE (pending guard)", psCount(w2) === b2.ps + 1 && w2.station.relayLog.filter((r) => r.endsWith("url-step")).length === 1 && w2.station.relayLog.filter((r) => r.endsWith("ignored-pending")).length === 9);
  w.orch.kill(); w2.orch.kill();
}
// 9 / 10. mirrored mpvAttemptId binds browser / phone to the REAL attempt
for (const who of ["browser", "phone"] as const) {
  const w = world(6); w.startAt(0);
  const prior = w.mirror().mpvAttemptId;
  w[who].select(3); w.sync(); // mirrored STATE_UPDATE of the new attempt
  const bound = w[who].events.find((e) => e.startsWith("bound:"));
  const newId = w.mirror().mpvAttemptId;
  assert(`T${who === "browser" ? 9 : 10} ${who}: mirrored mpvAttemptId present; bound to the NEW MAIN attempt (${prior} → ${newId})`, typeof prior === "number" && typeof newId === "number" && newId !== prior && bound === `bound:${newId}`, w[who].events.join(","));
  w.play(w.cur()); w.sync();
  assert(`T${who === "browser" ? 9 : 10}b ${who}: confirmed on that attempt's progress → Loading cleared`, w[who].t === null && w[who].events.includes("confirmed"));
  w.orch.kill();
}
// 11. another controller replaces our attempt → Loading clears immediately (before binding AND after binding)
{
  const w = world(6); w.startAt(0);
  w.phone.t = beginTransition({ origin: "select", targetKey: "pl#2", now: Date.now(), priorAttemptId: w.mirror().mpvAttemptId ?? null, audibleAtStart: true }); // our request in flight
  w.station.select(4); w.sync(); // another controller's selection lands first
  assert("T11 replaced BEFORE binding (new attempt plays another item) → cleared immediately", w.phone.t === null && w.phone.events.includes("superseded"), w.phone.events.join(","));
  const w2 = world(6); w2.startAt(0);
  w2.browser.select(2); // bound to its attempt
  w2.station.select(4); w2.sync(); // replaced while still loading
  assert("T11b replaced AFTER binding (a newer attempt) → cleared immediately", w2.browser.t === null && w2.browser.events.includes("superseded"), w2.browser.events.join(","));
  w.orch.kill(); w2.orch.kill();
}
// 12. the SAME already-playing item can never falsely confirm a new attempt on the OLD attempt's progress
{
  const w = world(6); w.startAt(1);
  w.browser.t = beginTransition({ origin: "select", targetKey: "pl#1", now: Date.now(), priorAttemptId: w.mirror().mpvAttemptId ?? null, audibleAtStart: true });
  w.cur().handleEvent({ event: "property-change", name: "time-pos", data: 5 });
  w.cur().handleEvent({ event: "property-change", name: "time-pos", data: 6 }); // old attempt keeps progressing
  assert("T12 same item already playing: old attempt progress → NOT bound / NOT confirmed (still Loading)", isBlocking(w.browser.t) && w.browser.t?.bound === false);
  w.orch.kill();
}
// 13 / 14. failed URL → exactly one safe next; old audible deck survives the failed standby
{
  const w = world(6); w.startAt(1);
  const audible = w.o.musicStA.status === "playing" ? "A" : "B";
  w.phone.nav("next"); // relayed → item 2 on standby
  const stops = w.calls.filter((c) => c === `${audible}:stop`).length;
  w.failAtZero(w.cur());
  assert("T13 failed relayed URL → exactly ONE safe next (item 3)", w.station.log.join(",") === "stepped" && w.station.sentIdx === 3 && w.lastLoadedUrl() === urlOf(3), w.station.log.join(","));
  assert("T14 old audible deck survives the failed standby", (audible === "A" ? w.o.musicStA : w.o.musicStB).status === "playing" && w.calls.filter((c) => c === `${audible}:stop`).length === stops);
  w.orch.kill();
}
// 15. no catalog / audio divergence — even when nothing consumes the relay
{
  const w = world(6, { withStation: false });
  w.station.select(2); w.play(w.cur()); w.sync();
  const before = { key: w.mirrorKey(), url: w.lastLoadedUrl(), ps: psCount(w) };
  for (let i = 0; i < 3; i++) { w.m.handleRemoteStep("NEXT"); w.m.push(); w.m.handleRemoteStep("PREV"); w.m.push(); }
  assert("T15 NEXT/PREV with no renderer to accept them → MAIN metadata unchanged (no N+1 while N plays)", w.mirrorKey() === before.key && w.lastLoadedUrl() === before.url && psCount(w) === before.ps);
  const w2 = world(6); w2.startAt(2);
  for (const d of ["next", "next", "prev"] as const) { w2.phone.nav(d); w2.play(w2.cur()); w2.sync(); }
  assert("T15b after phone NEXT, NEXT, PREV: mirrored item == loaded audio item (pl#3)", w2.mirrorKey() === "pl#3" && w2.lastLoadedUrl() === urlOf(3));
  w.orch.kill(); w2.orch.kill();
}
// MAIN without a station session keeps the existing catalog step (nothing audible to diverge from)
{
  const w = world(3);
  const m = w.mgr as unknown as { branchCatalog: unknown[] };
  m.branchCatalog = [{ id: "c1", title: "c1", cover: null, origin: "source", type: "youtube", url: urlOf(9) }];
  w.m.handleRemoteStep("NEXT");
  assert("T15c no station session → existing catalog selection unchanged (no relay, no load)", w.mirror().currentSource?.id === "c1" && w.urlLoads() === 0);
  w.orch.kill();
}

// ── static pins ──
const root = path.join(__dirname, "..", "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
const mgrSrc = rd("desktop/src/device-websocket-client/device-ws-manager.ts");
const dpc = rd("lib/device-player-context.tsx");
const scc = rd("lib/station-controller-context.tsx");
const relay = dpc.slice(dpc.indexOf("const relayedStep = useCallback"), dpc.indexOf("useEffect(() => { relayedStepRef.current = relayedStep; }"));
assert("S1 MAIN: WS NEXT/PREV → handleRemoteStep (relay while a station session exists; catalog step otherwise)",
  /if \(cmd === "PREV" \|\| cmd === "NEXT"\) \{\n            this\.handleRemoteStep\(cmd\);/.test(mgrSrc) && /if \(this\.mock\.getState\(\)\.currentSource\) \{\n      this\.sessionStepSeq \+= 1;/.test(mgrSrc));
assert("S2 MAIN: mirror carries mpvAttemptId (number only)", /if \(typeof mpv\.attemptId === "number"\) this\.state\.mpvAttemptId = mpv\.attemptId;/.test(rd("desktop/src/playback-agent/mock-playback-session.ts")));
assert("S3 renderer: relay consumer = baseline + (bootId, seq) exactly-once",
  /const last = stepRelayConsumedRef\.current;/.test(dpc) && /if \(last && last\.boot === reqBoot && reqSeq > last\.seq/.test(dpc));
assert("S4 renderer: relayedStep uses the station path and NEVER sends NEXT/PREV back to MAIN",
  /stepUrlSession\(direction\)/.test(relay) && /isBlocking\(urlTransitionRef\.current\)/.test(relay) && !/sendCommandToMaster|sendRemoteNav/.test(relay));
assert("S5 remotes observe with the mirrored attempt id",
  /mode: "remote",\n      attemptId: typeof masterState\?\.mpvAttemptId === "number"/.test(dpc) && /mode: "remote",\n      attemptId: typeof remoteState\?\.mpvAttemptId === "number"/.test(scc) && /beginNav\("next"\)/.test(scc) && /beginNav\("prev"\)/.test(scc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
