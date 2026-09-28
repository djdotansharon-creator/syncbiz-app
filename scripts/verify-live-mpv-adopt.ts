/**
 * Deterministic regression for live-MPV adoption on renderer remount (lib/live-mpv-adopt.ts).
 *
 * Adoption suppresses the initial loadfile, so it MUST prove the live engine is playing the SAME media the
 * renderer restored — via a canonical media key (hash; mt-token/fragment stripped). Any doubt (no live key,
 * key mismatch, engine not playing, stale attempt) → decline → normal loadfile (never silence).
 *
 * Run: npx tsx scripts/verify-live-mpv-adopt.ts
 */
import { shouldAdoptLiveMpv, mediaKey, canonicalMediaId } from "@/lib/live-mpv-adopt";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const A = "https://www.youtube.com/watch?v=AAA111";
const B = "https://www.youtube.com/watch?v=BBB222";
const livePlaying = { engineReady: true, status: "playing", attemptId: 6 };
const KEY_A = mediaKey(A);

// ── media key: canonical (strips volatile mt token + fragment; case-correct) ──────────────────────
// 4. same URL, different mt token → SAME media key
assert("key(4): mt token ignored → SAME", mediaKey("https://x/api/media/z?mt=TOKEN1") === mediaKey("https://x/api/media/z?mt=TOKEN2"));
// 5. same URL, fragment difference → SAME media key
assert("key(5): fragment ignored → SAME", mediaKey(A + "#t=30") === KEY_A);
// 1. differ only in HOSTNAME case → SAME media key (host is case-insensitive)
assert("key(1): hostname case only → SAME", mediaKey("https://YouTube.COM/watch?v=X") === mediaKey("https://youtube.com/watch?v=X"));
// 2. differ only in PATHNAME case → DIFFERENT media key (path is case-sensitive)
assert("key(2): pathname case → DIFFERENT", mediaKey("https://x/Path/Song") !== mediaKey("https://x/path/song"));
// 3. YouTube video id differs only in case → DIFFERENT media key (query values are case-sensitive)
assert("key(3): YouTube id case → DIFFERENT", mediaKey("https://youtube.com/watch?v=AbC123") !== mediaKey("https://youtube.com/watch?v=abc123"));
assert("key: different media → different key", mediaKey(A) !== mediaKey(B));
assert("key: empty → empty", mediaKey("") === "" && canonicalMediaId(null) === "");
// Windows local path identity stays case-insensitive (Windows FS is case-insensitive).
assert("key: local path case-insensitive → SAME", mediaKey("C:\\Music\\Song.mp3") === mediaKey("c:\\music\\song.mp3"));
// DIVERGENCE GUARD: the desktop's src/main/live-media-key.ts MUST produce this exact key for this vector
// (asserted identically in desktop/scripts/verify-attempt-mode.ts). If these drift, adoption breaks.
assert("key: fixed vector matches shared constant (guards app↔desktop parity)",
  mediaKey("https://www.youtube.com/watch?v=VEC777&mt=tok#frag") === "1f62bc4a");

// ── A. IDENTITY MATCH → ADOPT ─────────────────────────────────────────────────────────────────────
assert("A: live A + restored A + live key A + attemptId matches → ADOPT",
  shouldAdoptLiveMpv(true, A, livePlaying, KEY_A) === true);
assert("A': restored A carries an mt token but canonical-matches live key A → ADOPT",
  shouldAdoptLiveMpv(true, "https://x/api/media/z?mt=RENDERERTOKEN", livePlaying, mediaKey("https://x/api/media/z?mt=MASTERTOKEN")) === true);

// ── B. IDENTITY MISMATCH → DO NOT ADOPT (the safety hole this closes) ──────────────────────────────
assert("B: live A (key A) + restored B → NO adopt (mismatch)",
  shouldAdoptLiveMpv(true, B, livePlaying, KEY_A) === false);
assert("B': no live key reported (older desktop) → NO adopt (identity unprovable → safe loadfile)",
  shouldAdoptLiveMpv(true, A, livePlaying, undefined) === false && shouldAdoptLiveMpv(true, A, livePlaying, "") === false);

// ── engine-state guards (all decline BEFORE the key check) ────────────────────────────────────────
assert("no-adopt: not first dispatch → false (normal playback unchanged, no duplicate dispatch)",
  shouldAdoptLiveMpv(false, A, livePlaying, KEY_A) === false);
assert("no-adopt: engine idle → false (STOP stays stopped)",
  shouldAdoptLiveMpv(true, A, { engineReady: true, status: "idle", attemptId: 6 }, KEY_A) === false);
assert("no-adopt: engine paused → false (paused not auto-resumed)",
  shouldAdoptLiveMpv(true, A, { engineReady: true, status: "paused", attemptId: 6 }, KEY_A) === false);
assert("no-adopt: attemptId 0/missing → false (stale attempt not adopted)",
  shouldAdoptLiveMpv(true, A, { engineReady: true, status: "playing", attemptId: 0 }, KEY_A) === false &&
  shouldAdoptLiveMpv(true, A, { engineReady: true, status: "playing", attemptId: undefined }, KEY_A) === false);
assert("no-adopt: engineReady false → false (don't suppress a load on an unconfirmed engine)",
  shouldAdoptLiveMpv(true, A, { engineReady: false, status: "playing", attemptId: 6 }, KEY_A) === false);
assert("no-adopt: null snapshot / no url → false",
  shouldAdoptLiveMpv(true, A, null, KEY_A) === false && shouldAdoptLiveMpv(true, "", livePlaying, KEY_A) === false);

// ── local file playing live, identity matches → adopt ─────────────────────────────────────────────
{
  const local = "C:\\Music\\a.mp3";
  assert("adopt: local file + live playing + matching key → true",
    shouldAdoptLiveMpv(true, local, livePlaying, mediaKey(local)) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
