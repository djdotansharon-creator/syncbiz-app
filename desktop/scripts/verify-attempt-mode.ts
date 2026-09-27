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

console.log(`\n${pass} passed, ${fail} failed`);
