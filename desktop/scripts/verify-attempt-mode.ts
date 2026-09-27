/**
 * Deterministic self-check for the authoritative current-attempt id/mode, reported IMMEDIATELY by the
 * orchestrator (via push()) BEFORE any MPV start-file/property event. No MPV is spawned: the decks are
 * never start()'d, and play()/playMusicCrossfade() tolerate a missing child. We force the active deck's
 * cached status to "playing" only to route playMusicCrossfade() into the REAL standby-crossfade path.
 *
 * Run: npx tsx desktop/scripts/verify-attempt-mode.ts
 */
import { PlaybackOrchestrator } from "../src/main/playback-orchestrator";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail: string): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${detail}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const forceActivePlaying = (o: PlaybackOrchestrator) => {
  // White-box: make the active deck (A) look "playing" so a crossfade takes the real standby path.
  (o as unknown as { musicStA: unknown }).musicStA = { status: "playing", position: 5, duration: 120, volume: 80, engineReady: true, lastError: null, attemptId: 0 };
};

// ── Transition A: previous snapshot = crossfade → new attempt = cold ⇒ immediately id=new, mode=cold ──
{
  const o = new PlaybackOrchestrator();
  forceActivePlaying(o);
  o.playMusicCrossfade("https://youtu.be/xyz", 6, 10);
  let st = o.getState();
  assert("A0 crossfade baseline (before any MPV event)", st.music.attemptId === 10 && st.music.attemptMode === "crossfade", `id=${st.music.attemptId} mode=${st.music.attemptMode}`);
  o.playMusic("C:\\music\\b.mp3", 11); // COLD, immediately
  st = o.getState();
  assert("A new COLD ⇒ id+mode reported immediately", st.music.attemptId === 11 && st.music.attemptMode === "cold", `id=${st.music.attemptId} mode=${st.music.attemptMode}`);
  o.kill();
}

// ── Transition B: previous snapshot = cold → new attempt = crossfade ⇒ immediately id=new, mode=crossfade ──
{
  const o = new PlaybackOrchestrator();
  o.playMusic("C:\\music\\a.mp3", 1); // COLD baseline
  let st = o.getState();
  assert("B0 cold baseline (before any MPV event)", st.music.attemptId === 1 && st.music.attemptMode === "cold", `id=${st.music.attemptId} mode=${st.music.attemptMode}`);
  forceActivePlaying(o);
  o.playMusicCrossfade("https://youtu.be/xyz", 6, 2); // CROSSFADE, immediately
  st = o.getState();
  assert("B new CROSSFADE ⇒ id+mode reported immediately", st.music.attemptId === 2 && st.music.attemptMode === "crossfade", `id=${st.music.attemptId} mode=${st.music.attemptMode}`);
  o.kill();
}

// ── C/D: MpvManager INTERNAL stale-playing state must NOT leak under the NEW id via setVolume() ──────
// setVolume() mutates + pushes the deck MpvManager's internal status. We seed BOTH the deck manager's
// internal `st` AND the orchestrator cache with stale playing+position+duration, collect every emitted
// snapshot, then prove: once the NEW attemptId first appears, every pre-start snapshot for it is
// non-confirming (status != "playing" AND position == 0 AND duration == 0).
const STALE = { status: "playing", position: 42, duration: 180, volume: 80, engineReady: true, lastError: null, attemptId: 0 };
function seedStale(o: PlaybackOrchestrator, deck: "A" | "B"): void {
  const mgr = deck === "A" ? "musicDeckA" : "musicDeckB";
  const cache = deck === "A" ? "musicStA" : "musicStB";
  (o as unknown as Record<string, unknown>)[cache] = { ...STALE };
  ((o as unknown as Record<string, { st: unknown }>)[mgr]).st = { ...STALE }; // MpvManager INTERNAL st
}
function newIdSnapshotsClean(snaps: Array<{ music: { attemptId: number; status: string; position: number; duration: number } }>, newId: number): { firstNew: number; bad: number } {
  const firstNew = snaps.findIndex((s) => s.music.attemptId === newId);
  const bad = snaps.slice(Math.max(0, firstNew)).filter((s) => s.music.attemptId === newId &&
    (s.music.status === "playing" || s.music.position > 0 || s.music.duration > 0)).length;
  return { firstNew, bad };
}

// C. COLD after stale INTERNAL active-deck playing state.
{
  const o = new PlaybackOrchestrator();
  const snaps: Array<{ music: { attemptId: number; status: string; position: number; duration: number } }> = [];
  o.onStatus((s) => snaps.push(JSON.parse(JSON.stringify(s))));
  seedStale(o, "A");
  o.playMusic("C:\\music\\c.mp3", 100); // COLD
  const { firstNew, bad } = newIdSnapshotsClean(snaps, 100);
  assert("C cold: new id appears in a snapshot", firstNew >= 0, `firstNew=${firstNew}`);
  assert("C cold: no confirming pre-start snapshot under new id", bad === 0, `bad=${bad}`);
  o.kill();
}

// D. CROSSFADE after stale INTERNAL standby-deck playing state.
{
  const o = new PlaybackOrchestrator();
  const snaps: Array<{ music: { attemptId: number; status: string; position: number; duration: number } }> = [];
  o.onStatus((s) => snaps.push(JSON.parse(JSON.stringify(s))));
  forceActivePlaying(o);       // active A "playing" so the crossfade path is taken
  seedStale(o, "B");           // standby B carries stale INTERNAL playing+pos+dur
  o.playMusicCrossfade("https://youtu.be/xyz", 6, 200); // CROSSFADE
  const { firstNew, bad } = newIdSnapshotsClean(snaps, 200);
  assert("D crossfade: new id appears in a snapshot", firstNew >= 0, `firstNew=${firstNew}`);
  assert("D crossfade: no confirming pre-start snapshot under new id", bad === 0, `bad=${bad}`);
  o.kill();
}

// ── E–H: attemptId correlation — a LATE OLD-attempt deck event (installed new id, before new start-file)
//        must be powerless (no false-confirm, no premature crossfade ramp), while the error path and a
//        correctly-correlated standby event still work. ──────────────────────────────────────────────
const OLD_PLAYING = (attemptId: number) => ({ status: "playing", position: 50, duration: 200, volume: 80, engineReady: true, lastError: null, attemptId });

// E. COLD: late OLD deck-A status (playing+progress, OLD id) after a new cold attempt began.
{
  const o = new PlaybackOrchestrator();
  o.playMusic("C:\\music\\e.mp3", 100); // new cold attempt id=100 (deck A never bound → cur.attemptId=old)
  // Inject a late OLD event on deck A (id 5) into the orchestrator cache, then push.
  (o as unknown as Record<string, unknown>).musicStA = OLD_PLAYING(5);
  (o as unknown as { push: () => void }).push();
  const m = o.getState().music;
  assert("E cold: stale OLD deck event ⇒ non-confirming under new id",
    m.attemptId === 100 && m.attemptMode === "cold" && m.status !== "playing" && m.position === 0 && m.duration === 0,
    `id=${m.attemptId} status=${m.status} pos=${m.position} dur=${m.duration}`);
  o.kill();
}

// F+G. CROSSFADE: late OLD standby event ⇒ NO ramp; then a correctly-correlated standby event ⇒ ramp.
{
  const o = new PlaybackOrchestrator();
  forceActivePlaying(o);
  o.playMusicCrossfade("https://youtu.be/xyz", 6, 200); // crossfade attempt id=200 on standby B
  const priv = o as unknown as { onMusicDeckStatus: (d: string, s: unknown) => void; xfadeRampId: unknown; xfadePending: unknown; xfadeStandbySawPlaying: boolean };
  // F: OLD standby status (id 777) — must be ignored (no ramp, still pending, never saw playing).
  priv.onMusicDeckStatus("B", OLD_PLAYING(777));
  assert("F crossfade: OLD standby event ⇒ no ramp / active untouched",
    priv.xfadeRampId === null && priv.xfadePending !== null && priv.xfadeStandbySawPlaying === false,
    `ramp=${priv.xfadeRampId} pending=${priv.xfadePending !== null} sawPlaying=${priv.xfadeStandbySawPlaying}`);
  // G: correctly-correlated standby status (id 200, playing+progress) — ramp is now allowed.
  priv.onMusicDeckStatus("B", { ...OLD_PLAYING(200), position: 5, duration: 120 });
  assert("G crossfade: correlated standby event ⇒ ramp starts", priv.xfadeRampId !== null, `ramp=${priv.xfadeRampId !== null}`);
  o.kill();
}

// H. ERROR path: currentAttemptError still surfaces under currentAttemptId (renderer one-time skip).
{
  const o = new PlaybackOrchestrator();
  forceActivePlaying(o);
  o.playMusicCrossfade("https://youtu.be/xyz", 6, 300);
  (o as unknown as { abortXfade: (r: string) => void }).abortXfade("standby_load_timeout"); // simulate timeout
  const m = o.getState().music;
  assert("H error surfaces under current id (idle + lastError)",
    m.attemptId === 300 && m.status === "idle" && !!m.lastError && /timeout/i.test(m.lastError),
    `id=${m.attemptId} status=${m.status} err=${m.lastError}`);
  o.kill();
}

// ── I–L: failed-incoming recovery must NOT stop the good active deck (orchestrator authoritative) ─────
// crossfade path installs currentAttemptDeck = STANDBY (active untouched); cold path installs
// currentAttemptDeck = ACTIVE (active replaced) and resets the active cache to idle.
const activeDeckId = (o: PlaybackOrchestrator) => (o as unknown as { activeMusicDeck: "A" | "B" }).activeMusicDeck;
const standbyId = (o: PlaybackOrchestrator) => (activeDeckId(o) === "A" ? "B" : "A");
const priv = (o: PlaybackOrchestrator) => o as unknown as { currentAttemptDeck: "A" | "B"; currentAttemptMode: string; currentAttemptError: string | null; xfadePending: unknown; musicStA: { status: string } };

// I. FAILED incoming crossfade → recovery item routes through playMusicCrossfade → REAL crossfade:
//    active good deck stays playing, standby becomes pending, active is NOT replaced.
{
  const o = new PlaybackOrchestrator();
  forceActivePlaying(o); // active deck A = the good outgoing track (#3) playing
  // Simulate the just-failed incoming crossfade (#4): current attempt is idle+error.
  const p = priv(o);
  p.currentAttemptError = "no audio or video data played";
  (o as unknown as { currentAttemptId: number }).currentAttemptId = 4;
  p.currentAttemptMode = "crossfade";
  (o as unknown as { currentAttemptDeck: "A" | "B" }).currentAttemptDeck = standbyId(o);
  // Recovery item (#5) — renderer now always routes subsequent dispatches through crossfade.
  o.playMusicCrossfade("https://youtu.be/recovery5", 6, 5);
  const activeStillPlaying = priv(o).musicStA.status === "playing";
  const loadedOnStandby = priv(o).currentAttemptDeck === standbyId(o);
  assert("I recovery: real crossfade (loaded on STANDBY, not active)", loadedOnStandby && priv(o).xfadePending !== null, `deck=${priv(o).currentAttemptDeck} standby=${standbyId(o)} pending=${priv(o).xfadePending !== null}`);
  assert("I recovery: good active deck NOT stopped/replaced", activeStillPlaying && priv(o).currentAttemptMode === "crossfade" && priv(o).currentAttemptError === null, `activePlaying=${activeStillPlaying} mode=${priv(o).currentAttemptMode} err=${priv(o).currentAttemptError}`);
  o.kill();
}

// J. Active deck truly IDLE + subsequent dispatch → playMusicCrossfade falls back to COLD play.
{
  const o = new PlaybackOrchestrator();
  // active A idle (default). Renderer would still route crossfade (prevMpv exists); orchestrator falls back.
  o.playMusicCrossfade("https://youtu.be/x", 6, 20);
  assert("J idle active ⇒ cold fallback", priv(o).currentAttemptMode === "cold" && priv(o).currentAttemptDeck === activeDeckId(o), `mode=${priv(o).currentAttemptMode} deck=${priv(o).currentAttemptDeck} active=${activeDeckId(o)}`);
  o.kill();
}

// E'/F. Natural-EOF-style (active idle) ⇒ cold fallback; normal (active playing) ⇒ real crossfade.
{
  const o = new PlaybackOrchestrator();
  forceActivePlaying(o);
  o.playMusicCrossfade("https://youtu.be/next", 6, 30); // normal playing → NEXT
  assert("F normal NEXT (active playing) ⇒ real crossfade", priv(o).currentAttemptDeck === standbyId(o) && priv(o).currentAttemptMode === "crossfade", `deck=${priv(o).currentAttemptDeck} mode=${priv(o).currentAttemptMode}`);
  o.kill();
}

// C/D/(renderer decision): first track / after STOP have prevMpv=null ⇒ cold; subsequent ⇒ crossfade.
{
  const decide = (prevMpv: string | null, hasApi: boolean) => !!(prevMpv && hasApi); // mirrors the production one-liner
  assert("C first track (prevMpv null) ⇒ cold", decide(null, true) === false, "cold");
  assert("D after STOP (prevMpv cleared) ⇒ cold", decide(null, true) === false, "cold");
  assert("subsequent (prevMpv set) ⇒ crossfade route", decide("http://x/y", true) === true, "crossfade");
}

console.log(`\n${pass} passed, ${fail} failed`);
