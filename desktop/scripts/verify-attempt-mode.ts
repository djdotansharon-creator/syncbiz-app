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

console.log(`\n${pass} passed, ${fail} failed`);
