/**
 * P0 Gate 1f (2026-10-08) — DISPLAY: the audible item stays "now playing" while a new one loads; the pending item is
 * shown as Loading, never as playing; Loading ends at MAIN's incoming readiness (XFADE_RAMP_START); after a failed
 * load the screen never shows the failed item over the old music.
 * REAL PlaybackOrchestrator + DeviceWsManager (synthetic MPV events) + the REAL pure display / intent functions
 * (lib/url-transition-intent.ts). Controllers mirror DevicePlayerContext (station + remote) / StationControllerContext
 * (phone): held capture via holdsAudible, observation incl. `pending` (mpvAttemptPending). Static pins at the end.
 * Run (from desktop/): npx tsx scripts/verify-gate1f-display-state.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { DeviceWsManager } from "../src/device-websocket-client/device-ws-manager";
import type { StationPlaybackState } from "../src/shared/station-state";
import {
  MESSAGE_MS, beginTransition, displayPlaybackState, failTransition, holdsAudible, isBlocking, observeTransition,
  targetKeyOf, tickTransition, transitionLabel, type UrlTransition,
} from "../../lib/url-transition-intent";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean } };
type O = { musicDeckA: Deck; musicDeckB: Deck; currentAttemptDeck: "A" | "B"; activeMusicDeck: "A" | "B"; musicStA: { status: string }; musicStB: { status: string }; xfadeRampId: unknown };
const urlOf = (i: number) => `https://www.youtube.com/watch?v=dsp${String(i).padStart(8, "0")}`;
const tracks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, title: `Track ${i}`, cover: null, url: urlOf(i) }));
const payload = (i: number, pl = "pl") => ({ source: { id: `${pl}:track:r${i}`, title: `Track ${i}`, url: urlOf(i), type: "youtube", origin: "playlist", playlistId: pl, sessionTracks: tracks }, trackIndex: i });

function world() {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const observers: Array<() => void> = [];
  for (const d of [o.musicDeckA, o.musicDeckB]) {
    d.st.engineReady = true;
    const he = d.handleEvent.bind(d);
    d.handleEvent = (m) => { he(m); for (const f of observers) f(); };
  }
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void; mock: { getState: () => StationPlaybackState } };
  const toMain = (cmd: string, p?: unknown) => m.runTransportCommand(cmd, p, "ws");
  /** STATE_UPDATE snapshot as a controller receives it (a copy — never the live object) */
  const mirror = (): StationPlaybackState => JSON.parse(JSON.stringify(m.mock.getState()));
  const cur = () => (o.currentAttemptDeck === "A" ? o.musicDeckA : o.musicDeckB);
  const audibleTitle = () => (o.activeMusicDeck === "A" ? o.musicStA : o.musicStB).status === "playing";

  /** a controller (station renderer = DevicePlayerContext with IPC; remote/phone = mirrored state) */
  const makeCtl = (kind: "station" | "remote") => ({
    t: null as UrlTransition | null,
    held: null as StationPlaybackState | null,
    rampAtConfirm: null as boolean | null,
    setT(t: UrlTransition | null) { this.t = t; if (!holdsAudible(t)) this.held = null; },
    begin(key: string | null) {
      const ms = mirror();
      const audible = ms.status === "playing";
      if (!holdsAudible(this.t)) this.held = audible ? ms : null;
      this.t = beginTransition({ origin: "select", targetKey: key, now: Date.now(), priorAttemptId: kind === "station" ? mgr.snapshot().mpvAttemptId : (ms.mpvAttemptId ?? null), audibleAtStart: audible || !!this.held });
    },
    select(i: number, pl = "pl") { this.begin(targetKeyOf(`${pl}:track:r${i}`, i)); toMain("PLAY_SOURCE", payload(i, pl)); },
    observe() {
      if (!this.t) return;
      const s = mgr.snapshot(), ms = mirror();
      const obs = kind === "station"
        ? { mode: "station" as const, attemptId: s.mpvAttemptId, sourceId: null, trackIndex: null, status: s.mockPlaybackStatus, position: s.mpvPosition, error: s.mpvLastError || null, engineReady: s.mpvEngineReady !== false, pending: typeof s.mpvAttemptPending === "boolean" ? s.mpvAttemptPending : null }
        : { mode: "remote" as const, attemptId: ms.mpvAttemptId ?? null, sourceId: ms.currentSource?.id ?? null, trackIndex: ms.currentTrackIndex ?? null, status: ms.status, position: ms.position ?? 0, error: ms.mpvEngineError ?? null, engineReady: ms.mpvEngineReady !== false, pending: typeof ms.mpvAttemptPending === "boolean" ? ms.mpvAttemptPending : null };
      const res = observeTransition(this.t, obs);
      if (res.event === "confirmed") { this.rampAtConfirm = o.xfadeRampId !== null; this.setT(kind === "station" ? res.t : null); }
      else if (res.event === "failed" && res.t) this.setT(failTransition(res.t, Date.now()));
      else this.setT(res.t);
    },
    view() { return displayPlaybackState(mirror(), this.held, this.t); },
  });
  const station = makeCtl("station"), phone = makeCtl("remote");
  observers.push(() => station.observe(), () => phone.observe());
  const startFile = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 200 }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); };
  const progress = (d: Deck) => { d.handleEvent({ event: "property-change", name: "time-pos", data: 1 }); d.handleEvent({ event: "property-change", name: "time-pos", data: 2 }); };
  const failAtZero = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 225 }); d.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" }); };
  /** track 0 audible (cold, confirmed) */
  const start = () => { toMain("PLAY_SOURCE", payload(0)); startFile(cur()); progress(cur()); };
  return { orch, o, mgr, toMain, mirror, cur, audibleTitle, station, phone, startFile, progress, failAtZero, start };
}
const title = (v: { shown: StationPlaybackState | null }) => v.shown?.currentTrack?.title ?? null;

// ── same-playlist selection: held → pending → readiness ──
{
  const w = world(); w.start();
  w.station.select(3);
  const live = w.mirror();
  assert("D0 MAIN published the selection immediately (metadata-first) — the raw mirror says Track 3", live.currentTrack?.title === "Track 3");
  const sv = w.station.view();
  assert("D1 station: old Track 0 stays NOW PLAYING (status playing) while Track 3 loads", title(sv) === "Track 0" && sv.shown?.status === "playing" && sv.loading && transitionLabel(w.station.t) === "Loading…");
  assert("D2 station: pending = Track 3 (index 3, same session) — NOT the playing item", sv.pending?.index === 3 && sv.pending?.title === "Track 3" && sv.pending?.sameSession === true && sv.shown?.currentTrackIndex === 0);
  // queue mapping: highlight = shown index (0), pending row = 3
  const pendingRow = sv.pending && (sv.pending.sameSession || !w.station.held) ? sv.pending.index : null;
  assert("D3 queue: current row (bars) = 0, \"Loading…\" row = 3", sv.shown?.currentTrackIndex === 0 && pendingRow === 3);
  const sb = w.cur();
  w.startFile(sb);
  assert("D4 standby started (no progress yet) → still Loading, still Track 0 shown", w.station.view().loading && title(w.station.view()) === "Track 0");
  w.progress(sb);
  assert("D5 Loading ENDS at incoming readiness = XFADE_RAMP_START (ramp running at the confirm moment, not at XFADE_COMPLETE)",
    w.station.rampAtConfirm === true && !w.station.view().loading, String(w.station.rampAtConfirm));
  assert("D6 after readiness: Track 3 is NOW PLAYING (shown == live)", title(w.station.view()) === "Track 3" && w.station.view().shown?.currentTrackIndex === 3);
  w.orch.kill();
}
// ── phone (remote mirror) ──
{
  const w = world(); w.start();
  // phone captures held at ITS send time (before MAIN publishes), then the selection goes out
  w.phone.begin(targetKeyOf("pl:track:r2", 2));
  w.toMain("PLAY_SOURCE", payload(2));
  const pv = w.phone.view();
  assert("P1 phone: old Track 0 held as now playing (title + playing) while Track 2 loads", title(pv) === "Track 0" && pv.shown?.status === "playing" && pv.loading);
  assert("P2 phone: active badge = audible source (r0), NOT the pending one (r2)", pv.shown?.currentSource?.id === "pl:track:r0" && w.mirror().currentSource?.id === "pl:track:r2");
  w.startFile(w.cur()); w.progress(w.cur());
  assert("P3 phone: Loading ends at readiness (mirrored mpvAttemptPending=false) → Track 2 now playing, badge moves", w.phone.t === null && title(w.phone.view()) === "Track 2" && w.phone.rampAtConfirm === true);
  w.orch.kill();
}
// ── another playlist while audible → strip (not a row of the shown list) ──
{
  const w = world(); w.start();
  w.station.select(1, "other");
  const v = w.station.view();
  assert("X1 different playlist loading → shown list stays the audible session; pending sameSession=false (strip)", title(v) === "Track 0" && v.pending?.sameSession === false && v.pending?.title === "Track 1");
  w.orch.kill();
}
// ── failed load → old track stays shown; after the message MAIN's restored metadata = old track ──
{
  const w = world(); w.start();
  w.station.select(4);
  w.failAtZero(w.cur());
  const v = w.station.view();
  assert("F1 failed load: 'Couldn't play — current music kept'; Track 0 still shown; old deck audible", w.station.t?.phase === "failed-kept" && title(v) === "Track 0" && w.audibleTitle() && transitionLabel(w.station.t) === "Couldn't play — current music kept");
  assert("F2 MAIN restored its session (raw mirror = Track 0, not the failed Track 4)", w.mirror().currentTrack?.title === "Track 0" && w.mirror().currentTrackIndex === 0);
  w.station.setT(tickTransition(w.station.t, Date.now() + MESSAGE_MS + 1, true));
  assert("F3 after the message expires: shown == live == Track 0 (never the failed item over the old music)", w.station.t === null && title(w.station.view()) === "Track 0");
  w.orch.kill();
}
// ── cold (nothing audible) → the new item is shown as Loading, not playing ──
{
  const w = world();
  w.station.select(2);
  const v = w.station.view();
  assert("C1 nothing audible: shown = new item but status NOT playing; Loading; pending = its own row", title(v) === "Track 2" && v.shown?.status !== "playing" && v.loading && v.pending?.index === 2);
  w.startFile(w.cur()); w.progress(w.cur());
  assert("C2 cold first real progress → Loading ends, playing", !w.station.view().loading && w.station.view().shown?.status === "playing");
  w.orch.kill();
}
// ── legacy MAIN (no mpvAttemptPending) → old advancing-position rule still works ──
{
  let t: UrlTransition | null = beginTransition({ origin: "select", targetKey: "x#0", now: 0, priorAttemptId: 1_000_000_001, audibleAtStart: true });
  const base = { mode: "station" as const, attemptId: 1_000_000_002, sourceId: null, trackIndex: null, status: "playing", error: null, engineReady: true };
  t = observeTransition(t, { ...base, position: 1 }).t;
  const r = observeTransition(t, { ...base, position: 2 });
  assert("L1 no readiness field (older MAIN) → legacy advancing-position confirmation unchanged", r.event === "confirmed");
  assert("L2 readiness field present + pending=true → never confirmed by position alone", observeTransition(beginTransition({ origin: "select", targetKey: "x#0", now: 0, priorAttemptId: 1_000_000_001, audibleAtStart: true }), { ...base, position: 9, pending: true }).event !== "confirmed");
  assert("L3 holdsAudible: loading / trying-next / failed-kept hold; confirmed / failed-idle / not-sent release",
    holdsAudible({ ...t!, phase: "loading" }) && holdsAudible({ ...t!, phase: "trying-next" }) && holdsAudible({ ...t!, phase: "failed-kept" }) &&
    !holdsAudible({ ...t!, phase: "confirmed" }) && !holdsAudible({ ...t!, phase: "failed-idle" }) && !holdsAudible({ ...t!, phase: "not-sent" }) && !isBlocking({ ...t!, phase: "failed-kept" }));
}

// ── static pins: every surface uses the one display rule ──
const rd = (p: string) => readFileSync(path.join(__dirname, "..", "..", p), "utf-8").replace(/\r\n/g, "\n");
const lqp = rd("components/live-queue-panel.tsx"), mpc = rd("components/mobile/mobile-player-core.tsx");
const msr = rd("components/mobile/mobile-source-row.tsx"), mpcard = rd("components/mobile/mobile-playlist-card.tsx");
const dpc = rd("lib/device-player-context.tsx"), scc = rd("lib/station-controller-context.tsx"), ap = rd("components/audio-player.tsx");
assert("S1 queue: list + highlight come from displayPlaybackState (held), pending row shows Loading… not the bars",
  /const masterState = queueDisplay\.shown;/.test(lqp) && /\{isPendingRow \? \(/.test(lqp) && lqp.indexOf("{isPendingRow ? (") < lqp.indexOf('aria-label="Now playing">'));
assert("S2 phone player + badges read useStationDisplay().shown", /const rs = stationDisplay\.shown;/.test(mpc) && /remoteActive = stationDisplay\.shown\?\.currentSource\?\.id === source\.id/.test(msr) && /remoteActive = stationDisplay\.shown\?\.currentSource\?\.id === source\.id/.test(mpcard));
assert("S3 contexts: held kept through failed-kept (holdsAudible) + readiness observed (pending)",
  /urlTransitionHeldState: holdsAudible\(urlTransition\)/.test(dpc) && (dpc.match(/pending: typeof /g) ?? []).length === 2 && /transitionHeldState: holdsAudible\(transition\) \? heldState : null/.test(scc) && /pending: typeof remoteState\?\.mpvAttemptPending/.test(scc));
assert("S4 player area keeps the existing text \"Loading…\" (no logo / new UI)", /transitionLabel\(deviceCtx\?\.urlTransition\)/.test(ap));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
