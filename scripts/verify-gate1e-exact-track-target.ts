/**
 * P0 Gate 1e (2026-10-08) — LOCKED INVARIANT: a NON-LOCAL PLAY_SOURCE must never change session / display metadata
 * unless it also carries a valid playable target for THAT EXACT track.
 *
 * Reproduces the Lenovo incident (2026-10-07 21:19, station stack click → PLAY_SOURCE `…:track:r0` + trackIndex 1 / 24
 * with an EMPTY url → MAIN changed the title, MPV kept playing track 0) and proves the fix end to end with the REAL
 * desktop MAIN (DeviceWsManager + PlaybackOrchestrator, synthetic MPV events) and the REAL renderer pure functions
 * (resolveExactUrlTarget / resolveUrlSessionJump / resolveUrlSessionStep / unifiedSourceToPayload / url-eof / intent).
 * The station controller mirrors lib/device-player-context.tsx (playSourceOrSend URL branch, stepUrlSession,
 * jumpUrlSession, relay consumer, observeUrlTransition) — pinned statically at the end.
 * Run: npx tsx scripts/verify-gate1e-exact-track-target.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveExactUrlTarget, resolveUrlSessionJump, resolveUrlSessionStep, ownPlayableUrl } from "../lib/station-transport-routing";
import { unifiedSourceToPayload } from "../lib/remote-control/source-to-payload";
import { expandPlaylistEntityToItems } from "../lib/syncbiz-playlist-queue";
import { initialUrlEofState, observeUrlEof, disarmUrlEof } from "../lib/url-eof-advance";
import {
  MAX_CONSECUTIVE_FAILURES, beginTransition, decideUserCommand, failTransition, isBlocking, observeTransition,
  targetKeyOf, type TransitionOrigin, type UrlTransition,
} from "../lib/url-transition-intent";
import type { UnifiedSource } from "../lib/source-types";

// Desktop MAIN is loaded at RUNTIME (require), not via typed imports: the root tsconfig (and the Next.js build's type
// check on the TEST app image) must never follow into desktop/ — desktop deps such as `ws` exist only in desktop/.
type MvpStatusSnapshot = {
  mpvAttemptId: number; mockPlaybackStatus: string; mpvPosition: number; mpvDuration: number; mpvLastError: string | null; mpvEngineReady: boolean;
  sessionStepBootId?: string; sessionStepSeq?: number; sessionStepDirection?: "next" | "prev" | "jump" | null; sessionStepIndex?: number | null; sessionStepSessionId?: string | null;
};
type OrchLike = { kill(): void };
type MgrLike = { snapshot(): MvpStatusSnapshot; onStatus(fn: (s: MvpStatusSnapshot) => void): void };
const ROOT = path.join(__dirname, "..");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PlaybackOrchestrator } = require(path.join(ROOT, "desktop", "src", "main", "playback-orchestrator")) as { PlaybackOrchestrator: new () => OrchLike };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DeviceWsManager } = require(path.join(ROOT, "desktop", "src", "device-websocket-client", "device-ws-manager")) as { DeviceWsManager: new (cfg: unknown, orch: OrchLike) => MgrLike };

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const N = 25;
const SHELL = "pl-b07af457-044e-47d8-b422-00ef97d8e9bb";
const urlOf = (i: number) => `https://www.youtube.com/watch?v=trk${String(i).padStart(8, "0")}`;
const titleOf = (i: number) => `Track ${i}`;
const playlist = { id: SHELL, name: "Deep HOUSE mix", type: "youtube", url: "", thumbnail: "", tracks: Array.from({ length: N }, (_, i) => ({ id: `t${i}`, name: titleOf(i), type: "youtube", url: urlOf(i) })) };
const shellSource = { id: SHELL, title: "Deep HOUSE mix", genre: "Mixed", cover: null, type: "youtube", url: "", origin: "playlist", playlist } as unknown as UnifiedSource;
const leaves = expandPlaylistEntityToItems(shellSource);

type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean }; play: (u: string, id?: number) => void; stop: () => void; setVolume: (v: number) => void; pause: () => void };
type O = { musicDeckA: Deck; musicDeckB: Deck; currentAttemptDeck: "A" | "B"; musicStA: { status: string }; musicStB: { status: string } };
type Mirror = { currentSource?: { id?: string; sourceType?: string } | null; currentTrack?: { title?: string } | null; currentTrackIndex?: number; sessionTracks?: unknown[]; status: string; position?: number; mpvAttemptId?: number; mpvEngineError?: string | null; mpvEngineReady?: boolean };

function world() {
  const orch = new PlaybackOrchestrator();
  const o = orch as unknown as O;
  const loads: string[] = []; // every MPV loadfile (deck.play) — "deck:url"
  const calls: string[] = [];
  const observers: Array<() => void> = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? o.musicDeckA : o.musicDeckB;
    d.st.engineReady = true;
    const pl = d.play.bind(d), st = d.stop.bind(d), sv = d.setVolume.bind(d), pa = d.pause.bind(d), he = d.handleEvent.bind(d);
    d.play = (u, a) => { loads.push(`${id}:${u}`); calls.push(`${id}:play`); pl(u, a); };
    d.stop = () => { calls.push(`${id}:stop`); st(); };
    d.setVolume = (v) => { calls.push(`${id}:vol=${v}`); sv(v); };
    d.pause = () => { calls.push(`${id}:pause`); pa(); };
    d.handleEvent = (m) => { he(m); for (const f of observers) f(); };
  }
  const mgr = new DeviceWsManager({ deviceId: "dsk-test", branchId: "default", wsUrl: "", wsToken: "" } as never, orch);
  const m = mgr as unknown as { runTransportCommand: (c: string, p: unknown, s: string) => void; handleRemoteStep: (c: "NEXT" | "PREV") => void; handleRemoteJump: (p: unknown) => void; push: () => void; mock: { getState: () => Mirror } };
  const wsCmds: string[] = [];
  /** WS COMMAND handler (MASTER) */
  const toMain = (cmd: string, payload?: unknown) => {
    wsCmds.push(cmd);
    if (cmd === "NEXT" || cmd === "PREV") m.handleRemoteStep(cmd);
    else if (cmd === "JUMP_SESSION_INDEX") m.handleRemoteJump(payload);
    else m.runTransportCommand(cmd, payload, "ws");
    m.push();
  };
  const mirror = () => m.mock.getState();
  const deck = (id: "A" | "B") => (id === "A" ? o.musicDeckA : o.musicDeckB);
  const cur = () => deck(o.currentAttemptDeck);
  const attempt = () => mgr.snapshot().mpvAttemptId;

  // ── station renderer (mirror of lib/device-player-context.tsx) ──
  const station = {
    t: null as UrlTransition | null,
    sent: null as UnifiedSource | null,
    eof: initialUrlEofState(),
    consumed: null as { boot: string; seq: number } | null,
    log: [] as string[],
    begin(origin: TransitionOrigin, key: string | null, failures = 0) {
      const s = mgr.snapshot();
      this.t = beginTransition({ origin, targetKey: key, now: Date.now(), priorAttemptId: s.mpvAttemptId, audibleAtStart: s.mockPlaybackStatus === "playing", consecutiveFailures: failures });
    },
    /** playSourceOrSend — URL branch */
    select(source: UnifiedSource, trackIndex = 0) {
      const exact = resolveExactUrlTarget(source, trackIndex);
      if ("reject" in exact || !unifiedSourceToPayload(exact.source).url) { this.log.push("rejected:" + ("reject" in exact ? exact.reject : "no url")); return; }
      const key = targetKeyOf(exact.source.id, exact.trackIndex);
      if (decideUserCommand(this.t, { kind: "select", targetKey: key }) !== "accept") { this.log.push("dup"); return; }
      this.begin("select", key);
      this.eof = disarmUrlEof(this.eof);
      this.sent = exact.source;
      toMain("PLAY_SOURCE", { source: unifiedSourceToPayload(exact.source), trackIndex: exact.trackIndex });
    },
    /** stepUrlSession */
    step(dir: "next" | "prev", o2?: { noWrap?: boolean; origin?: TransitionOrigin; failures?: number }): boolean {
      const ms = mirror();
      const st = resolveUrlSessionStep({ sentLeaf: this.sent, mainSourceId: ms.currentSource?.id ?? null, mainTrackIndex: ms.currentTrackIndex ?? null, mainSessionTrackCount: ms.sessionTracks?.length ?? null, direction: dir, repeatMode: o2?.noWrap ? "off" : "playlist" });
      if (!st) return false;
      this.eof = disarmUrlEof(this.eof);
      if ("noop" in st) return true;
      if (!ownPlayableUrl(st.leaf)) { this.log.push("step-rejected"); return true; }
      this.sent = st.leaf;
      this.begin(o2?.origin ?? (o2?.noWrap ? "auto-eof" : dir), targetKeyOf(st.leaf.id, st.trackIndex), o2?.failures ?? 0);
      toMain("PLAY_SOURCE", { source: unifiedSourceToPayload(st.leaf), trackIndex: st.trackIndex });
      return true;
    },
    /** jumpUrlSession (station stack row) */
    jump(index: number): boolean {
      const ms = mirror();
      const j = resolveUrlSessionJump({ sentLeaf: this.sent, mainSourceId: ms.currentSource?.id ?? null, mainSessionTrackCount: ms.sessionTracks?.length ?? null, targetIndex: index });
      if (!j) { this.log.push("jump-rejected"); return false; }
      const key = targetKeyOf(j.leaf.id, j.trackIndex);
      if (decideUserCommand(this.t, { kind: "select", targetKey: key }) !== "accept") { this.log.push("dup"); return true; }
      this.eof = disarmUrlEof(this.eof);
      this.sent = j.leaf;
      this.begin("select", key);
      toMain("PLAY_SOURCE", { source: unifiedSourceToPayload(j.leaf), trackIndex: j.trackIndex });
      return true;
    },
    nav(dir: "next" | "prev") { if (isBlocking(this.t)) return; if (!this.step(dir)) toMain(dir === "next" ? "NEXT" : "PREV"); },
    /** desktop onStatus: relay consumer + transition + url-eof */
    onSnapshot(s: MvpStatusSnapshot) {
      const boot = s.sessionStepBootId ?? null, seq = s.sessionStepSeq ?? null;
      if (boot !== null && seq !== null) {
        const last = this.consumed;
        this.consumed = { boot, seq: Math.max(seq, last && last.boot === boot ? last.seq : 0) };
        if (last && last.boot === boot && seq > last.seq) {
          if (s.sessionStepDirection === "next" || s.sessionStepDirection === "prev") { if (!isBlocking(this.t)) this.step(s.sessionStepDirection); }
          else if (s.sessionStepDirection === "jump" && typeof s.sessionStepIndex === "number") {
            const own = this.sent ? this.sent.id.split(":track:")[0] : null;
            if (own && (s.sessionStepSessionId ?? "").split(":track:")[0] === own) this.jump(s.sessionStepIndex); else this.log.push("jump-ignored");
          }
        }
      }
    },
    observe() {
      const s = mgr.snapshot();
      if (this.t) {
        const res = observeTransition(this.t, { mode: "station", attemptId: s.mpvAttemptId, sourceId: null, trackIndex: null, status: s.mockPlaybackStatus, position: s.mpvPosition, error: s.mpvLastError || null, engineReady: s.mpvEngineReady !== false });
        if (res.event === "failed" && res.t) {
          const failures = (res.t.phase === "confirmed" ? 0 : res.t.consecutiveFailures) + 1;
          const before = this.t;
          const sent = failures < MAX_CONSECUTIVE_FAILURES && this.step("next", { noWrap: true, origin: "auto-failure", failures }) && this.t !== before;
          this.log.push(sent ? "fail-stepped" : "fail-kept");
          if (!sent) this.t = failTransition(res.t, Date.now());
        } else this.t = res.t;
      }
      const r = observeUrlEof(this.eof, { status: s.mockPlaybackStatus, attemptId: s.mpvAttemptId, position: s.mpvPosition, duration: s.mpvDuration, lastError: s.mpvLastError || null, engineReady: s.mpvEngineReady !== false }, !!this.sent?.playlist);
      this.eof = r.state;
      if (r.advance) { this.log.push("eof-step"); this.step("next", { noWrap: true }); }
    },
  };
  // ── remote (browser web CONTROL): jumpToSessionIndexOrSend remote path ──
  const browser = {
    t: null as UrlTransition | null,
    jump(index: number) {
      const sid = mirror().currentSource?.id ?? "";
      const shell = sid.split(":track:")[0];
      const key = targetKeyOf(`${shell}:track:r${index}`, index);
      if (decideUserCommand(this.t, { kind: "select", targetKey: key }) !== "accept") return;
      this.t = beginTransition({ origin: "select", targetKey: key, now: Date.now(), priorAttemptId: mirror().mpvAttemptId ?? null, audibleAtStart: mirror().status === "playing" });
      toMain("JUMP_SESSION_INDEX", { trackIndex: index, sessionSourceId: sid });
    },
    observe() {
      if (!this.t) return;
      const ms = mirror();
      const res = observeTransition(this.t, { mode: "remote", attemptId: ms.mpvAttemptId ?? null, sourceId: ms.currentSource?.id ?? null, trackIndex: ms.currentTrackIndex ?? null, status: ms.status, position: ms.position ?? 0, error: ms.mpvEngineError ?? null, engineReady: ms.mpvEngineReady !== false });
      this.t = res.event === "confirmed" ? null : res.event === "failed" && res.t ? failTransition(res.t, Date.now()) : res.t;
    },
  };
  let delivering = false; const q: MvpStatusSnapshot[] = [];
  mgr.onStatus((s) => { q.push(s); if (delivering) return; delivering = true; while (q.length) station.onSnapshot(q.shift()!); delivering = false; });
  observers.push(() => station.observe(), () => browser.observe());
  const play = (d: Deck, dur = 200) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); d.handleEvent({ event: "property-change", name: "time-pos", data: 1 }); d.handleEvent({ event: "property-change", name: "time-pos", data: 2 }); };
  const failAtZero = (d: Deck) => { d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: 225 }); d.handleEvent({ event: "end-file", reason: "error", file_error: "loading failed" }); };
  const naturalEnd = (d: Deck) => { d.handleEvent({ event: "property-change", name: "time-pos", data: 199 }); d.handleEvent({ event: "end-file", reason: "eof" }); };
  /** what the audio is + what the UI shows */
  const audioUrl = () => { const l = loads[loads.length - 1]; return l ? l.slice(2) : null; };
  const shown = () => ({ title: mirror().currentTrack?.title ?? null, idx: mirror().currentTrackIndex ?? null, id: mirror().currentSource?.id ?? null });
  const coherent = (i: number) => audioUrl() === urlOf(i) && shown().title === titleOf(i) && shown().idx === i;
  const start = () => { station.consumed = null; m.push(); station.select(leaves[0], 0); play(cur()); };
  return { orch, o, mgr, m, loads, calls, wsCmds, mirror, cur, attempt, station, browser, play, failAtZero, naturalEnd, audioUrl, shown, coherent, toMain, start };
}

// ── INCIDENT REPRODUCTION (pre-1e request shape) → MAIN defence ──
{
  const w = world(); w.start();
  const before = { shown: w.shown(), loads: w.loads.length, attempt: w.attempt() };
  // exactly what the deployed renderer sent at 21:19:02 / 21:19:24: leaf r0 id, empty url, mirrored tracks, trackIndex 1 / 24
  for (const ti of [1, 24]) w.toMain("PLAY_SOURCE", { source: { id: `${SHELL}:track:r0`, title: "Deep HOUSE mix", type: "youtube", url: "", origin: "playlist", playlistId: SHELL, sessionTracks: playlist.tracks.map((t) => ({ id: t.id, title: t.name, cover: null })) }, trackIndex: ti });
  assert("I1 MAIN defence: non-LOCAL PLAY_SOURCE with empty url → REJECTED before metadata (title / index / id unchanged)",
    JSON.stringify(w.shown()) === JSON.stringify(before.shown) && w.shown().title === titleOf(0), JSON.stringify(w.shown()));
  assert("I2 … no attempt created, no MPV load, audible track 0 untouched", w.loads.length === before.loads && w.attempt() === before.attempt && w.coherent(0));
  // the renderer side: the pre-1e reconstructed source (mirror tracks without urls) is rejected — nothing is sent
  const synth = { id: `${SHELL}:track:r0`, title: "Deep HOUSE mix", genre: "Mixed", cover: null, type: "youtube", url: "", origin: "playlist", playlist: { id: SHELL, name: "Deep HOUSE mix", tracks: playlist.tracks.map((t) => ({ id: t.id, name: t.name, title: t.name })) } } as unknown as UnifiedSource;
  const sent = w.wsCmds.length;
  w.station.select(synth, 24);
  assert("I3 renderer fail-closed: reconstructed source (no track urls) for index 24 → nothing sent, metadata + audio unchanged", w.wsCmds.length === sent && w.station.log.at(-1)?.startsWith("rejected:") === true && w.coherent(0), w.station.log.at(-1));
  // a borrowed r0 leaf WITH urls + trackIndex 24 is re-resolved to leaf 24 (never r0's URL / id)
  w.station.select(leaves[0], 24); w.play(w.cur());
  assert("I4 borrowed leaf r0 + trackIndex 24 → resolved to leaf r24 (its own URL + id), never r0's", w.coherent(24) && w.shown().id === `${SHELL}:track:r24`, JSON.stringify(w.shown()));
  w.orch.kill();
}
// ── STATION absolute jumps 0 / 1 / 24: one attempt + one loadfile each, exact URL, UI == audio ──
{
  const w = world(); w.start();
  assert("J0 click track 0 → correct URL loaded, title == audio", w.coherent(0) && w.loads.length === 1);
  for (const i of [1, 24]) {
    const a0 = w.attempt(), l0 = w.loads.length;
    const titleBeforeLoad = w.shown().title;
    w.station.jump(i);
    const titleOk = w.shown().title === titleOf(i) && w.loads.length === l0 + 1 && w.loads.at(-1)!.endsWith(urlOf(i)); // title moved ONLY together with its load
    w.play(w.cur());
    assert(`J${i} station click track ${i} → exactly 1 new MAIN attempt + 1 MPV loadfile of track ${i}'s URL; UI == audio`,
      w.attempt() !== a0 && w.attempt() > a0 && w.loads.length === l0 + 1 && w.coherent(i) && titleOk && titleBeforeLoad !== titleOf(i), `${w.audioUrl()}`);
  }
  w.orch.kill();
}
// ── NEXT / PREV / EOF / 1b continue from the jumped index ──
{
  const w = world(); w.start();
  w.station.jump(24); w.play(w.cur());
  w.station.nav("prev"); w.play(w.cur());
  assert("N1 PREV after jump to 24 → 23 (continues from the actual new index)", w.coherent(23));
  w.station.jump(10); w.play(w.cur());
  w.station.nav("next"); w.play(w.cur());
  assert("N2 NEXT after jump to 10 → 11", w.coherent(11));
  w.station.jump(5); w.play(w.cur());
  w.naturalEnd(w.cur()); w.play(w.cur());
  assert("N3 natural EOF after jump to 5 → exactly one step to 6", w.coherent(6) && w.station.log.filter((x) => x === "eof-step").length === 1, w.station.log.join(","));
  const w2 = world(); w2.start();
  w2.station.jump(24); w2.play(w2.cur());
  const l24 = w2.loads.length;
  w2.station.nav("next"); w2.play(w2.cur());
  assert("N4 NEXT after track 24 (last item) steps from 24 (loop 'playlist' → item 0 via the session, one load)", w2.loads.length === l24 + 1 && w2.coherent(0) && w2.shown().id === `${SHELL}:track:r0`);
  const w3 = world(); w3.start();
  w3.station.jump(12);
  const aud = w3.o.musicStA.status === "playing" ? "A" : "B";
  const stops = w3.calls.filter((c) => c === `${aud}:stop`).length;
  w3.failAtZero(w3.cur());
  assert("N5 1b: jumped item 12 fails → exactly one safe next = 13 (from the correct item); old audible deck kept",
    w3.station.log.includes("fail-stepped") && w3.loads.at(-1)!.endsWith(urlOf(13)) && (aud === "A" ? w3.o.musicStA : w3.o.musicStB).status === "playing" && w3.calls.filter((c) => c === `${aud}:stop`).length === stops, w3.station.log.join(","));
  w.orch.kill(); w2.orch.kill(); w3.orch.kill();
}
// ── dedupe + newest wins + old deck protected ──
{
  const w = world(); w.start();
  const l0 = w.loads.length;
  for (let k = 0; k < 10; k++) w.station.jump(7);
  assert("D1 10× same track click while pending → 1 effective load", w.loads.length === l0 + 1 && w.station.log.filter((x) => x === "dup").length === 9);
  w.station.jump(9);
  assert("D2 different track during pending → accepted (newest explicit selection wins)", w.loads.length === l0 + 2 && w.loads.at(-1)!.endsWith(urlOf(9)));
  const aud = w.o.musicStA.status === "playing" ? "A" : "B";
  assert("D3 old audible deck still playing until the new track confirms", (aud === "A" ? w.o.musicStA : w.o.musicStB).status === "playing");
  w.play(w.cur());
  assert("D4 after confirm → UI == audio (track 9)", w.coherent(9));
  w.orch.kill();
}
// ── BROWSER (remote CONTROL) absolute jump via the exactly-once relay ──
{
  const w = world(); w.start();
  const a0 = w.attempt(), l0 = w.loads.length;
  w.browser.jump(24);
  assert("B1 browser click track 24 → MAIN relays one jump; station sends the exact item → 1 attempt + 1 loadfile of track 24's URL",
    w.loads.length === l0 + 1 && w.loads.at(-1)!.endsWith(urlOf(24)) && w.attempt() !== a0);
  w.play(w.cur());
  assert("B2 browser: UI == audio (track 24), Loading confirmed + cleared", w.coherent(24) && w.browser.t === null);
  const l1 = w.loads.length;
  for (let k = 0; k < 10; k++) w.m.push(); // same relay request re-delivered
  assert("B3 exactly-once relay unchanged: re-delivered jump request → 0 extra loads", w.loads.length === l1);
  w.station.consumed = null; w.m.push(); w.m.push(); // renderer remount
  assert("B4 remount never replays the old jump", w.loads.length === l1);
  // stale jump for another session → ignored, no metadata change
  const before = JSON.stringify(w.shown());
  w.toMain("JUMP_SESSION_INDEX", { trackIndex: 3, sessionSourceId: "pl-other:track:r0" });
  assert("B5 jump for a different session → ignored; MAIN metadata unchanged (no divergence)", JSON.stringify(w.shown()) === before && w.loads.length === l1 && w.station.log.at(-1) === "jump-ignored");
  w.orch.kill();
}
// ── PHONE: per-track selection from the mobile playlist page = the exact track's own URL (single-item select) ──
{
  const w = world(); w.start();
  const t = playlist.tracks[17];
  const synth = { id: `${SHELL}:track:${t.id}`, title: t.name, genre: "Mixed", cover: null, type: "youtube", url: t.url, origin: "source" } as unknown as UnifiedSource; // app/(app)/mobile/library/playlist/[id]
  const l0 = w.loads.length;
  w.station.select(synth, 0); w.play(w.cur()); // same playSourceOrSend URL branch rules (remote web CONTROL)
  assert("P1 phone track select → 1 load of exactly that track's URL; UI title == that track (no divergence)", w.loads.length === l0 + 1 && w.audioUrl() === urlOf(17) && w.shown().title === titleOf(17));
  w.orch.kill();
}
// ── LOCAL unchanged: LOCAL metadata-only sync still applies (type "local", empty url, no load) ──
{
  const w = world();
  w.toMain("PLAY_SOURCE", { source: { id: "local-pl", title: "Local Mix", type: "local", url: "", origin: "playlist", sessionTracks: [{ id: "a", title: "A", cover: null }, { id: "b", title: "B", cover: null }] }, trackIndex: 1 });
  assert("L1 LOCAL PLAY_SOURCE (type local, url stripped) → metadata sync unchanged, no MAIN load", w.shown().id === "local-pl" && w.shown().title === "B" && w.loads.length === 0);
  w.orch.kill();
}

// ── static pins ──
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const dpc = rd("lib/device-player-context.tsx");
const mgrSrc = rd("desktop/src/device-websocket-client/device-ws-manager.ts");
const lqp = rd("components/live-queue-panel.tsx");
const ps = mgrSrc.slice(mgrSrc.indexOf('case "PLAY_SOURCE": {'), mgrSrc.indexOf('case "PAUSE":', mgrSrc.indexOf('case "PLAY_SOURCE": {')));
assert("S1 MAIN: empty-url non-LOCAL reject sits BEFORE setStationSession", ps.indexOf("PLAY_SOURCE rejected — non-LOCAL source without a playable URL") > 0 && ps.indexOf("PLAY_SOURCE rejected") < ps.indexOf("this.mock.setStationSession("));
assert("S2 MAIN: JUMP_SESSION_INDEX → handleRemoteJump (relay only, no metadata)", /else if \(cmd === "JUMP_SESSION_INDEX"\) \{\n            this\.handleRemoteJump\(p\.payload\);/.test(mgrSrc) && !/setStationSession|navigateCatalogStep/.test(mgrSrc.slice(mgrSrc.indexOf("private handleRemoteJump"), mgrSrc.indexOf("private navigateCatalogStep"))));
assert("S3 renderer: URL select resolves the exact target + fails closed before any intent / send",
  dpc.indexOf("const exact = source ? resolveExactUrlTarget(source, trackIndex)") > 0 && dpc.indexOf("const exact = source ? resolveExactUrlTarget(source, trackIndex)") < dpc.indexOf('beginUrlTransition("select", selectKey)'));
assert("S4 renderer: session steps fail closed on a URL-less item; jumpUrlSession uses resolveUrlSessionJump", /if \(!ownPlayableUrl\(step\.leaf\)\)/.test(dpc) && /const j = resolveUrlSessionJump\(\{/.test(dpc));
assert("S5 live-queue: mirrored URL session rows jump BY INDEX through the owner (no reconstructed source)", lqp.indexOf("deviceCtx.jumpToSessionIndexOrSend(originalIndex, mirrored.id)") > 0 && lqp.indexOf("deviceCtx.jumpToSessionIndexOrSend(originalIndex, mirrored.id)") < lqp.indexOf("let src = sessionForList.currentSource;"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
