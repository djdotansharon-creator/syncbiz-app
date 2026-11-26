// "A song's length is remembered the first time it plays" (owner 2026-11-26). Pure rules of lib/play-length-learn.ts + wiring of components/play-length-learner.tsx.
// Also measured in a browser test (Player + Remote, a real 30 s audio file with no stored length): the Remote reported { track: 30 } once and the server stored it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { learnTargetOf, sameSample, LEARN_MAX_SECONDS, LEARN_MIN_POSITION, LEARN_MIN_SECONDS } from "../lib/play-length-learn";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const base = { status: "playing", duration: 213, position: 20, currentTrackIndex: 1, sessionPlaylistId: "pl1", sessionTracks: [{ id: "t0", durationSeconds: 100 }, { id: "t1" }, { id: "t2" }] };
const t = learnTargetOf(base);
assert("P1 a playing song with no stored length, a believable length and some seconds played is remembered, keyed by its own track id", !!t && t.playlistId === "pl1" && t.trackId === "t1" && t.seconds === 213, JSON.stringify(t));
assert("P2 a song whose length is already stored is never offered again (the server never overwrites it either)", learnTargetOf({ ...base, currentTrackIndex: 0 }) === null);
assert("P3 nothing is offered while paused / stopped / idle", ["paused", "stopped", "idle", undefined].every((st) => learnTargetOf({ ...base, status: st }) === null));
assert("P4 no saved playlist behind the song (a single link, a radio station) -> nothing", learnTargetOf({ ...base, sessionPlaylistId: null }) === null && learnTargetOf({ ...base, sessionPlaylistId: "  " }) === null);
assert("P5 a length that is not believable is never remembered: too short (a jingle), too long (a live stream), zero, NaN, missing", [LEARN_MIN_SECONDS - 1, LEARN_MAX_SECONDS + 1, 0, NaN, undefined].every((d) => learnTargetOf({ ...base, duration: d as number }) === null) && learnTargetOf({ ...base, duration: LEARN_MIN_SECONDS, position: 6 }) !== null);
assert("P6 only after the song has really played a few seconds (a placeholder length shown while it loads is not taken), and never when the position is past the length", learnTargetOf({ ...base, position: LEARN_MIN_POSITION - 1 }) === null && learnTargetOf({ ...base, position: LEARN_MIN_POSITION }) !== null && learnTargetOf({ ...base, position: 999 }) === null);
assert("P7 a track index that points at no song gives nothing", learnTargetOf({ ...base, currentTrackIndex: 9 }) === null && learnTargetOf({ ...base, currentTrackIndex: -1 }) === null && learnTargetOf({ ...base, sessionTracks: undefined }) === null);
assert("P8 the same song with the same length (within a second) seen twice is confirmed; another song or another length is not", sameSample(t, learnTargetOf({ ...base, duration: 212.6 })) && !sameSample(t, learnTargetOf({ ...base, duration: 240 })) && !sameSample(t, learnTargetOf({ ...base, currentTrackIndex: 2 })) && !sameSample(t, null));

const comp = rd("components/play-length-learner.tsx");
assert("W1 DATA ONLY: the component imports nothing from the player, the playback state or the WebSocket code (it only reads the mirrored status) and sends numbers keyed by track id, never a path or an address", !/from "@\/(lib|components)\/(playback|audio-player|remote|ws)/.test(comp) && /body: JSON\.stringify\(\{ durations: \{ \[again\.trackId\]: again\.seconds \} \}\)/.test(comp) && !/\.url\b/.test(comp));
assert("W2 it waits for the SAME song and length to stay for a few seconds (a track change cancels it) and reports each song once per page", /const CONFIRM_MS = 4000/.test(comp) && /!sameSample\(first, again\)/.test(comp) && /reported\.has\(k\)/.test(comp) && /return \(\) => window\.clearTimeout\(timer\)/.test(comp));
assert("W3 it is mounted once next to the other renders-null helpers", /import \{ PlayLengthLearner \} from "@\/components\/play-length-learner";/.test(rd("app/(app)/providers.tsx")) && (rd("app/(app)/providers.tsx").match(/<PlayLengthLearner \/>/g) ?? []).length === 1);
const route = rd("app/api/playlists/[id]/track-durations/route.ts");
assert("W4 the server side is unchanged and keeps its rules: access like the playlist's own routes, only a song with no length gets one, numbers only", /gatePlaylistAccess/.test(route) && /applyTrackDurations/.test(route) && /sanitizeTrackDurations/.test(route));
console.log(`\n${pass} passed, ${fail} failed`);
