/**
 * P0 (2026-10-07) — URL ownership vs stale LOCAL automix (RENDERER ONLY).
 *
 * Reproduces the 11:49Z incident and proves the fix on the REAL desktop PlaybackOrchestrator + MPV deck event handling,
 * the REAL URL-EOF tracker (lib/url-eof-advance.ts, pending 8e8895a), the REAL mix-point maths and the REAL ownership
 * predicate. A station harness mirrors components/audio-player.tsx's desktop near-end AUTOMIX scheduler + attempt
 * re-arm + LOCAL dispatch, and lib/device-player-context.tsx's URL session wiring; static pins tie the harness to
 * those files. No MPV process.
 * Run: npx tsx scripts/verify-p0-url-owner-automix.ts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { rendererOwnsSnapshot } from "../lib/playback-ownership";
import { mixPointThresholdSec } from "../lib/playback-transition/deck-transition-engine";
import { initialUrlEofState, observeUrlEof, disarmUrlEof, MAIN_WS_ATTEMPT_BASE, type UrlEofState } from "../lib/url-eof-advance";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const ROOT = path.join(__dirname, "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf-8").replace(/\r\n/g, "\n");

type Music = { status: string; attemptId: number; position: number; duration: number; lastError: string | null; engineReady: boolean };
type Deck = { handleEvent: (m: Record<string, unknown>) => void; st: { engineReady: boolean } };
type Orch = { playMusic(u: string, id: number): void; playMusicCrossfade(u: string, f: number, id: number): void; kill(): void; getState(): { music: Music }; musicDeckA: Deck; musicDeckB: Deck };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PlaybackOrchestrator } = require(path.join(ROOT, "desktop", "src", "main", "playback-orchestrator")) as { PlaybackOrchestrator: new () => Orch };

const MIX_SEC = 12;
const LOCAL = ["C:\\music\\l0.mp3", "C:\\music\\l1.mp3", "C:\\music\\l2.mp3", "C:\\music\\l3.mp3"];
const URLS = ["https://www.youtube.com/watch?v=r0", "https://www.youtube.com/watch?v=r1", "https://www.youtube.com/watch?v=r2"];

/** Station harness. `guard` = the fix (false reproduces the pre-fix scheduler). */
function station(guard: boolean) {
  const orch = new PlaybackOrchestrator();
  for (const d of [orch.musicDeckA, orch.musicDeckB]) d.st.engineReady = true;
  const loads: { kind: "local" | "url"; ref: string; attemptId: number; crossfade: boolean }[] = [];
  // ── renderer provider (stale LOCAL queue lives here) ──
  const provider = { status: "idle" as string, queue: [...LOCAL], index: 0, get currentPlayUrl() { return this.status === "playing" ? this.queue[this.index] : null; }, nextCalls: 0 };
  let gen = 0;                 // playbackAttemptGenRef
  let mpvLastUrl: string | null = null;
  let latched = false;         // mpvDesktopMixStartedRef
  let mixArmAttempt: number | null = null;
  // ── renderer → MAIN LOCAL dispatch (audio-player routing effect) ──
  const dispatchLocal = () => {
    const url = provider.currentPlayUrl!;
    if (url === mpvLastUrl) return;
    const prev = mpvLastUrl; mpvLastUrl = url; gen += 1;
    if (prev) orch.playMusicCrossfade(url, MIX_SEC, gen); else orch.playMusic(url, gen);
    loads.push({ kind: "local", ref: url, attemptId: gen, crossfade: !!prev });
  };
  const providerNext = () => { provider.nextCalls++; if (provider.index + 1 < provider.queue.length) { provider.index++; dispatchLocal(); } };
  // ── device-player-context URL session (WS PLAY_SOURCE → MAIN) ──
  let localSessionOwned = true; let urlIndex = -1; let mainSeq = 0; let eof: UrlEofState = initialUrlEofState();
  const mainPlayUrl = (i: number) => {
    const id = MAIN_WS_ATTEMPT_BASE + ++mainSeq; urlIndex = i;
    const s = orch.getState().music.status;
    if (s === "playing" || s === "paused") orch.playMusicCrossfade(URLS[i], MIX_SEC, id); else orch.playMusic(URLS[i], id);
    loads.push({ kind: "url", ref: URLS[i], attemptId: id, crossfade: s === "playing" });
  };
  const selectUrl = (i: number) => { eof = disarmUrlEof(eof); localSessionOwned = false; mainPlayUrl(i); }; // provider untouched (stale "playing")
  const selectLocal = (i: number) => { localSessionOwned = true; provider.status = "playing"; provider.index = i; dispatchLocal(); };
  // ── MPV events on the deck holding the CURRENT attempt ──
  const curDeck = () => ((orch as unknown as { currentAttemptDeck: "A" | "B" }).currentAttemptDeck === "A" ? orch.musicDeckA : orch.musicDeckB);
  // ── one status push = what both renderer listeners see ──
  const onSnapshot = () => {
    const m = orch.getState().music;
    // attempt re-arm effect (audio-player)
    if (m.attemptId !== mixArmAttempt) { mixArmAttempt = m.attemptId; latched = false; }
    // near-end AUTOMIX scheduler (audio-player) — mirrors the real effect line by line
    let fired = false;
    (() => {
      if (provider.status !== "playing") return;
      if (!provider.currentPlayUrl) return;
      if (guard && !rendererOwnsSnapshot(m.attemptId, gen)) return;
      const pos = m.position, dur = m.duration;
      if (!Number.isFinite(pos) || !Number.isFinite(dur) || dur <= 0) return;
      if (provider.index + 1 >= provider.queue.length) return; // getNextStreamUrl
      const mixAt = mixPointThresholdSec(dur, MIX_SEC);
      if (pos < mixAt || latched) return;
      latched = true; fired = true;
      providerNext();
    })();
    // URL EOF tracker (device-player-context, 8e8895a)
    const urlSessionActive = !localSessionOwned && urlIndex >= 0;
    const r = observeUrlEof(eof, { status: m.status, attemptId: m.attemptId, position: m.position, duration: m.duration, lastError: m.lastError, engineReady: m.engineReady }, urlSessionActive);
    eof = r.state;
    if (r.advance) { eof = disarmUrlEof(eof); if (urlIndex + 1 < URLS.length) mainPlayUrl(urlIndex + 1); }
    return fired;
  };
  const start = (dur: number) => { const d = curDeck(); d.handleEvent({ event: "start-file" }); d.handleEvent({ event: "property-change", name: "duration", data: dur }); d.handleEvent({ event: "property-change", name: "core-idle", data: false }); d.handleEvent({ event: "property-change", name: "time-pos", data: 0.5 }); d.handleEvent({ event: "property-change", name: "time-pos", data: 1.2 }); onSnapshot(); };
  const playTo = (pos: number) => { curDeck().handleEvent({ event: "property-change", name: "time-pos", data: pos }); return onSnapshot(); };
  const eofNow = () => { curDeck().handleEvent({ event: "end-file", reason: "eof" }); onSnapshot(); };
  return { orch, loads, provider, selectUrl, selectLocal, start, playTo, eofNow, get gen() { return gen; }, get urlIndex() { return urlIndex; } };
}

(async () => {
  // ── 0. ROOT CAUSE reproduction (pre-fix scheduler) ───────────────────────────────────────────────────────────
  {
    const s = station(false);
    s.selectLocal(0); s.start(200); s.playTo(60);
    s.selectUrl(0); s.start(240);           // URL r0 owns playback through MAIN; provider still "playing" LOCAL
    let fired = false; for (let p = 200; p <= 232; p += 2) fired = s.playTo(p) || fired;
    const localAfterUrl = s.loads.slice(s.loads.findIndex((l) => l.kind === "url")).filter((l) => l.kind === "local");
    assert("0 ROOT CAUSE reproduced: without the guard the URL's position drives LOCAL automix ~12 s before EOF → LOCAL crossfade load",
      fired && localAfterUrl.length === 1 && localAfterUrl[0].crossfade && localAfterUrl[0].ref === LOCAL[1], JSON.stringify(localAfterUrl));
    s.orch.kill();
  }
  // ── 1 / 2 / 3 / 4 / 10. with the fix ───────────────────────────────────────────────────────────────────────
  {
    const s = station(true);
    s.selectLocal(0); s.start(200); s.playTo(60);                    // LOCAL playing, automix armed for its attempt
    const nextBefore = s.provider.nextCalls;
    s.selectUrl(0); s.start(240);
    let fired = false; for (let p = 100; p <= 239; p += 1) fired = s.playTo(p) || fired;
    const urlStartIdx = s.loads.findIndex((l) => l.kind === "url");
    assert("1 LOCAL automix armed → user selects URL → stale LOCAL automix cannot fire", !fired && s.provider.nextCalls === nextBefore);
    assert("2 URL near its natural end → no LOCAL PLAY_REQUEST / load", s.loads.slice(urlStartIdx).every((l) => l.kind === "url"));
    assert("4 stale LOCAL queue stays in memory but never takes ownership", s.provider.queue.length === LOCAL.length && s.provider.status === "playing" && s.orch.getState().music.attemptId > MAIN_WS_ATTEMPT_BASE);
    s.eofNow();
    const after = s.loads.slice(urlStartIdx);
    assert("3 URL EOF → exactly ONE URL → URL advance (r0 → r1) via the pending 8e8895a tracker", after.length === 2 && after[1].kind === "url" && after[1].ref === URLS[1] && s.urlIndex === 1);
    s.start(180); s.eofNow();
    assert("3b next URL EOF → r2, still no LOCAL", s.loads.slice(urlStartIdx).map((l) => l.ref).join(",") === URLS.join(","));
    s.eofNow(); // duplicate EOF delivery
    assert("10 no duplicate load (one load per step; duplicate EOF ignored; last item no loop)", s.loads.slice(urlStartIdx).length === 3);
    s.orch.kill();
  }
  // ── 5. explicit URL → LOCAL: LOCAL starts and its automix works again ─────────────────────────────────────────
  {
    const s = station(true);
    s.selectUrl(0); s.start(240); s.playTo(120);
    s.selectLocal(1); s.start(200);
    const localAttempt = s.orch.getState().music.attemptId;
    assert("5a explicit URL → LOCAL: LOCAL loads under the renderer's own attempt", s.loads[s.loads.length - 1].kind === "local" && localAttempt === s.gen && localAttempt < MAIN_WS_ATTEMPT_BASE);
    let fired = false; for (let p = 150; p <= 199; p += 1) fired = s.playTo(p) || fired;
    assert("5b LOCAL automix resumes normally after the explicit switch (crossfade to the next LOCAL item)", fired && s.loads[s.loads.length - 1].ref === LOCAL[2] && s.loads[s.loads.length - 1].crossfade);
    s.orch.kill();
  }
  // ── 6. LOCAL-only automix unchanged (fires exactly once per track at the mix point) ──────────────────────────
  {
    const s = station(true);
    s.selectLocal(0); s.start(200);
    let fires = 0; for (let p = 100; p <= 199; p += 1) if (s.playTo(p)) fires++;
    const mixAt = mixPointThresholdSec(200, MIX_SEC);
    assert("6 LOCAL-only: automix fires exactly once at the mix point → crossfade to LOCAL item 1", fires === 1 && s.loads.length === 2 && s.loads[1].ref === LOCAL[1] && s.loads[1].crossfade, `mixAt=${mixAt}`);
    s.orch.kill();
  }

  // ── static pins ─────────────────────────────────────────────────────────────────────────────────────────────
  const ap = read("components", "audio-player.tsx");
  const sched = ap.slice(ap.indexOf("// Desktop MPV: advance at mix point"), ap.indexOf("}, [desktopMpvSnap, status, currentPlayUrl, getNextStreamUrl]);"));
  assert("S1 the scheduler checks ownership after the HLS guard and BEFORE reading position / firing",
    /if \(!currentPlayUrl \|\| isHlsUrl\(currentPlayUrl\)\) return;\n(?:\s*\/\/[^\n]*\n)*\s*if \(!rendererOwnsSnapshot\(desktopMpvSnap\.attemptId, playbackAttemptGenRef\.current\)\) return;\n\n\s*const pos = desktopMpvSnap\.position;/.test(sched));
  assert("S2 scheduler otherwise unchanged (latch gate + next({ skipPlay }) + deps)",
    /if \(pos < mixAt \|\| mpvDesktopMixStartedRef\.current\) return;\s*\n\s*mpvDesktopMixStartedRef\.current = true;/.test(ap) &&
    /nextRef\.current\(\{ skipPlay: true, auditTransportCase: "ended_auto" \}\);\s*\n\s*\}, \[desktopMpvSnap, status, currentPlayUrl, getNextStreamUrl\]\);/.test(ap));
  assert("S3 manual LOCAL NEXT unchanged", /const nextOrSend = useCallback\(\(\) => \{\s*if \(transportRunsLocally\(\)\) next\(\);/.test(read("lib", "device-player-context.tsx")));
  assert("S4 helper semantics: only the renderer's own numeric attempt", rendererOwnsSnapshot(5, 5) && !rendererOwnsSnapshot(MAIN_WS_ATTEMPT_BASE + 1, 5) && !rendererOwnsSnapshot(undefined, 0) && !rendererOwnsSnapshot("5", 5));
  // 8e8895a (URL EOF tracker) must stay intact: the ownership fix is a separate commit on top of it.
  const eofTouched = execSync(`git diff --name-only 8e8895a -- lib/url-eof-advance.ts`, { cwd: ROOT }).toString().trim();
  assert("S5 8e8895a URL-EOF tracker unchanged by this fix", eofTouched === "", eofTouched);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(process.exitCode ?? 0);
})();
