/**
 * P0 (2026-10-07) — crossfade incoming-deck readiness. Drives the REAL PlaybackOrchestrator + MpvManager status
 * machinery with synthetic MPV IPC events (no MPV process is spawned; decks are never start()'d). Proves a STREAM
 * incoming deck only starts the A/B ramp after REAL time-pos progress while not core-idle / paused-for-cache,
 * that LOCAL keeps the legacy fast rule, and that promotion re-asserts target volume + pause=false.
 * Run (from desktop/): npx tsx scripts/verify-p0-crossfade-readiness.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";
import { isCrossfadeIncomingReady } from "../src/main/crossfade-readiness";
import { isStreamLoadTarget } from "../src/main/mpv-input-normalize";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Deck = {
  handleEvent: (m: Record<string, unknown>) => void;
  setVolume: (v: number) => void;
  resume: () => void;
  stop: () => void;
};
type Orch = {
  musicDeckA: Deck; musicDeckB: Deck; musicStA: unknown; musicStB: unknown;
  activeMusicDeck: "A" | "B"; xfadePending: unknown; xfadeRampId: unknown; masterVolume: number;
};

/** Instrumented orchestrator: records every setVolume / resume / stop per deck. */
function harness(activeUrlIsLocal = true) {
  const o = new PlaybackOrchestrator();
  const w = o as unknown as Orch;
  const calls: string[] = [];
  for (const id of ["A", "B"] as const) {
    const d = id === "A" ? w.musicDeckA : w.musicDeckB;
    const sv = d.setVolume.bind(d), rs = d.resume.bind(d), st = d.stop.bind(d);
    d.setVolume = (v) => { calls.push(`${id}:vol=${v}`); sv(v); };
    d.resume = () => { calls.push(`${id}:resume`); rs(); };
    d.stop = () => { calls.push(`${id}:stop`); st(); };
  }
  // Active deck A is audibly playing (white-box, as in verify-attempt-mode.ts).
  w.musicStA = { status: "playing", position: 30, duration: 200, volume: 80, engineReady: true, lastError: null, attemptId: 0,
    coreIdle: false, pausedForCache: false, positionAt: Date.now(), progressObserved: true, fileLoaded: true, _local: activeUrlIsLocal };
  const deck = (id: "A" | "B") => (id === "A" ? w.musicDeckA : w.musicDeckB);
  const standbyId = () => (w.activeMusicDeck === "A" ? "B" : "A");
  const ev = (id: "A" | "B", m: Record<string, unknown>) => deck(id).handleEvent(m);
  const prop = (id: "A" | "B", name: string, data: unknown) => ev(id, { event: "property-change", name, data });
  const ramping = () => w.xfadeRampId !== null;
  const pending = () => w.xfadePending !== null;
  const outgoingLowered = (id: "A" | "B") => calls.some((c) => c.startsWith(`${id}:vol=`) && Number(c.split("=")[1]) < w.masterVolume);
  return { o, w, calls, ev, prop, ramping, pending, standbyId, outgoingLowered };
}

const URL1 = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const URL2 = "https://www.youtube.com/watch?v=bbbbbbbbbbb";
const LOCAL1 = "C:\\music\\one.mp3";
const LOCAL2 = "C:\\music\\two.mp3";

(async () => {
  // ── 0. Root cause: the legacy rule accepted "playing + duration known" while still buffering ────────────
  const buffering = { status: "playing", position: 0, duration: 215, coreIdle: true, pausedForCache: true, progressObserved: false };
  assert("0 root cause: legacy rule (LOCAL path) would start on duration alone", isCrossfadeIncomingReady(buffering, false) === true);
  assert("0 fix: STREAM incoming with duration known but buffering is NOT ready", isCrossfadeIncomingReady(buffering, true) === false);
  assert("0 classification: youtube / http are stream; local path is not",
    isStreamLoadTarget(URL1) && isStreamLoadTarget("http://radio.example/x.mp3") && !isStreamLoadTarget(LOCAL1));

  // ── 1–4. STREAM incoming deck readiness sequence ─────────────────────────────────────────────────────────
  {
    const h = harness();
    h.o.playMusicCrossfade(URL1, 1, 1_000_000_001);
    const sb = h.standbyId();
    h.ev(sb, { event: "start-file" });
    h.prop(sb, "core-idle", true);
    h.ev(sb, { event: "file-loaded" });
    h.prop(sb, "duration", 215.4);
    h.prop(sb, "time-pos", 0);
    assert("1 duration known, position=0, coreIdle=true → NO crossfade", !h.ramping() && h.pending());
    h.prop(sb, "core-idle", false);
    h.prop(sb, "time-pos", 0);
    assert("2 duration known, position=0, coreIdle=false → still NO crossfade (no real progress)", !h.ramping() && h.pending());
    // 4. buffers again before readiness: progress seen but paused-for-cache / core-idle return.
    h.prop(sb, "paused-for-cache", true);
    h.prop(sb, "core-idle", true);
    h.prop(sb, "time-pos", 0.35); // a progress step observed, but while buffering
    assert("4 incoming re-buffers before readiness → NO crossfade", !h.ramping() && h.pending());
    assert("4 outgoing deck stays audible (never lowered, never stopped)", !h.outgoingLowered("A") && !h.calls.includes("A:stop"), h.calls.join(","));
    // 3. buffering clears + real progress → crossfade starts.
    h.prop(sb, "paused-for-cache", false);
    h.prop(sb, "core-idle", false);
    h.prop(sb, "time-pos", 0.52);
    assert("3 real time-pos progress + coreIdle=false + not paused-for-cache → crossfade starts", h.ramping() && !h.pending());
    // 5. promotion re-asserts target volume + pause=false on the NEW active deck.
    await sleep(1400);
    const w = h.w;
    assert("5 swap completed — incoming deck promoted", w.activeMusicDeck === sb && !h.ramping());
    const promotedTail = h.calls.slice(h.calls.indexOf("A:stop"));
    assert("5 promotion re-asserts target volume on promoted deck", promotedTail.includes(`${sb}:vol=${w.masterVolume}`), promotedTail.join(","));
    assert("5 promotion re-asserts pause=false (resume) on promoted deck", promotedTail.includes(`${sb}:resume`), promotedTail.join(","));
    assert("5 old deck stopped only AFTER the ramp completed", h.calls.indexOf("A:stop") > h.calls.lastIndexOf(`A:vol=0`));
    h.o.kill();
  }

  // ── 3b. progress requires two REAL time-pos updates of THIS load (stale pre-start-file tick never counts) ──
  {
    const h = harness();
    h.o.playMusicCrossfade(URL1, 1, 1_000_000_002);
    const sb = h.standbyId();
    h.prop(sb, "time-pos", 5); h.prop(sb, "time-pos", 6); // stale ticks BEFORE start-file
    h.ev(sb, { event: "start-file" });
    h.prop(sb, "core-idle", false);
    h.prop(sb, "duration", 200);
    assert("3b stale pre-start-file progress is reset by start-file → NO crossfade", !h.ramping() && h.pending());
    h.prop(sb, "time-pos", 0.1);
    assert("3b a single time-pos (no advance yet) → NO crossfade", !h.ramping());
    h.prop(sb, "time-pos", 0.3);
    assert("3b advance observed → crossfade starts", h.ramping());
    h.o.kill();
  }

  // ── 6. LOCAL → LOCAL: legacy fast rule unchanged (duration evidence suffices, no progress wait) ──────────
  {
    const h = harness(true);
    h.o.playMusicCrossfade(LOCAL2, 1, 7);
    const sb = h.standbyId();
    h.ev(sb, { event: "start-file" });
    h.prop(sb, "duration", 180);
    assert("6 LOCAL→LOCAL starts on start-file + duration (unchanged fast path)", h.ramping());
    await sleep(1400);
    assert("6 LOCAL→LOCAL swap completes + promotion normalized", h.w.activeMusicDeck === sb && h.calls.includes(`${sb}:resume`));
    h.o.kill();
  }

  // ── 7. LOCAL → URL ────────────────────────────────────────────────────────────────────────────────────────
  // ── 8/9. URL → URL NEXT then URL → URL PREV (the previous URL again) · 10. URL → LOCAL ──────────────────────
  {
    const h = harness(true);
    const step = async (url: string, id: number, stream: boolean): Promise<boolean> => {
      h.o.playMusicCrossfade(url, 1, id);
      const sb = h.standbyId();
      h.ev(sb, { event: "start-file" });
      h.prop(sb, "duration", 200);
      if (stream) {
        if (h.ramping()) return false; // must wait for real progress
        h.prop(sb, "core-idle", false); h.prop(sb, "time-pos", 0.1); h.prop(sb, "time-pos", 0.4);
      }
      const started = h.ramping();
      await sleep(1400);
      // the newly active deck now plays: keep its cached status "playing" for the next crossfade
      return started && h.w.activeMusicDeck === sb;
    };
    assert("7 LOCAL→URL crossfades after real progress", await step(URL1, 1_000_000_010, true));
    assert("8 URL→URL NEXT crossfades after real progress", await step(URL2, 1_000_000_011, true));
    assert("9 URL→URL PREV crossfades after real progress", await step(URL1, 1_000_000_012, true));
    assert("10 URL→LOCAL crossfades on the LOCAL fast rule", await step(LOCAL1, 1_000_000_013, false));
    h.o.kill();
  }

  // ── never-ready STREAM: timeout path still keeps the current track (unchanged abort semantics) ───────────
  {
    const h = harness();
    h.o.playMusicCrossfade(URL1, 1, 1_000_000_020);
    const sb = h.standbyId();
    h.ev(sb, { event: "start-file" });
    h.prop(sb, "duration", 200);
    (h.o as unknown as { abortXfade: (r: string) => void }).abortXfade("standby_load_timeout");
    assert("never-ready stream → abort keeps the outgoing deck at target (no fade into silence)",
      h.w.activeMusicDeck === "A" && !h.outgoingLowered("A") && h.calls.includes(`${sb}:stop`));
    h.o.kill();
  }

  // ── static: global MPV "playing" semantics unchanged; readiness is crossfade-local; logging change-only ───
  const src = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
  const mm = src("src/main/mpv-manager.ts");
  const orch = src("src/main/playback-orchestrator.ts");
  assert("static: pause → status mapping unchanged", /case "pause":\n\s*this\.st\.status = data === true \? "paused" : "playing";/.test(mm));
  assert("static: start-file still sets status playing", /this\.st\.status = "playing";\n\s*this\.st\.position = 0;\n\s*this\.resetLoadProgress\(\);/.test(mm));
  const readinessCases = mm.slice(mm.indexOf('case "core-idle":'), mm.indexOf('} else if (ev === "start-file")'));
  assert("static: core-idle / paused-for-cache handlers never touch status", readinessCases.length > 0 && !/st\.status/.test(readinessCases));
  assert("static: readiness gate used ONLY in the crossfade standby handler", (orch.match(/isCrossfadeIncomingReady\(/g) ?? []).length === 1);
  assert("static: no fileLog inside the per-tick ramp interval", !/setInterval\(\(\) => \{[^}]*fileLog/.test(orch));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
})();
