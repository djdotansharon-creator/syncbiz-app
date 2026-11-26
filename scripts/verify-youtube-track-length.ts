// "A NEW YouTube song's length is read in the browser that needs it" (owner 2026-11-26). Pure rules of lib/youtube-track-length.ts + the wiring in the Schedules Studio.
// Also measured in a real browser run (headless Chromium against real YouTube): a new single with no stored length was picked in the schedule popup; the hidden embed answered in 0.3 - 1.2 s,
// { trackId: 253 } was saved, the block was drawn 5 minutes long, and no embed was left on the page.
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanVideoId, parseProbeMessage, probeSrc, youtubeTracksMissingLength, PROBE_CAP_BROWSER, PROBE_CAP_STATION, PROBE_CONCURRENCY, PROBE_TIMEOUT_MS } from "../lib/youtube-track-length";
import type { Playlist } from "../lib/playlist-types";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

assert("P1 the length is read from the embed's first delivery (object or JSON text), whole seconds", parseProbeMessage({ event: "initialDelivery", info: { duration: 253.4, playerState: 5 } }) === 253 && parseProbeMessage(JSON.stringify({ event: "infoDelivery", info: { duration: 214 } })) === 214);
assert("P2 anything that is not a believable duration gives nothing: no info, no duration, a live stream (0), too long, NaN, text, null", [{ event: "onReady" }, { info: {} }, { info: { duration: 0 } }, { info: { duration: 13 * 3600 } }, { info: { duration: NaN } }, "not json", null, undefined, 5].every((m) => parseProbeMessage(m) === null));
assert("P3 a video id is exactly 11 URL-safe characters", cleanVideoId("9bZkp7q19f0") === "9bZkp7q19f0" && cleanVideoId("dQw4w9WgXcQ") === "dQw4w9WgXcQ" && cleanVideoId("short") === null && cleanVideoId("has space!!") === null && cleanVideoId(null) === null && cleanVideoId("../../etc/passwd") === null);
const src = probeSrc("9bZkp7q19f0", "https://app.example.com");
assert("P4 the hidden embed is only CUED: autoplay=0, muted, no controls, the API handshake on, the page's origin passed (encoded)", /^https:\/\/www\.youtube\.com\/embed\/9bZkp7q19f0\?/.test(src) && /autoplay=0/.test(src) && !/autoplay=1/.test(src) && /mute=1/.test(src) && /controls=0/.test(src) && /enablejsapi=1/.test(src) && /origin=https%3A%2F%2Fapp\.example\.com/.test(src));

const T = (id: string, type: string, url: string, durationSeconds?: number | null) => ({ id, name: "Same name", type, url, durationSeconds });
const pl = { id: "p1", name: "Same name", url: "https://www.youtube.com/watch?v=9bZkp7q19f0", type: "youtube", tracks: [
  T("a", "youtube", "https://www.youtube.com/watch?v=9bZkp7q19f0"),
  T("b", "youtube", "https://youtu.be/dQw4w9WgXcQ", 213),
  T("c", "local", "C:\\Music\\x.mp3"),
  T("d", "stream-url", "https://example.com/a.mp3"),
  T("e", "youtube", "https://www.youtube.com/watch?v=9bZkp7q19f0&list=RDxyz"),
  T("f", "youtube", "https://www.youtube.com/playlist?list=PLabc"),
  T("g", "youtube", "https://www.youtube.com/watch?v=kJQP7kiw5Fk"),
] } as unknown as Playlist;
const todo = youtubeTracksMissingLength(pl);
assert("P5 only YouTube songs with NO length are listed, by their own track id: a song whose length is known, a local file, a stream and a YouTube playlist link are not (names are never used - two songs with the same name stay apart)", JSON.stringify(todo.map((t) => t.id)) === JSON.stringify(["a", "e", "g"]), JSON.stringify(todo));
assert("P6 the same video twice in a playlist keeps BOTH track ids (one probe, both songs get the length)", todo.filter((t) => t.videoId === "9bZkp7q19f0").length === 2);
const single = { id: "s1", name: "One song", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", type: "youtube" } as unknown as Playlist;
assert("P7 a one-song playlist (no stored track list) IS the song: its track id is the playlist's own id", JSON.stringify(youtubeTracksMissingLength(single)) === JSON.stringify([{ id: "s1", videoId: "dQw4w9WgXcQ" }]));
assert("P8 gentle by construction: at most 2 embeds at a time, fewer videos per run on the station's own computer (it plays music), a hard timeout per video", PROBE_CONCURRENCY <= 2 && PROBE_CAP_STATION < PROBE_CAP_BROWSER && PROBE_TIMEOUT_MS <= 10_000);

const lib = rd("lib/youtube-track-length.ts");
assert("W1 NOTHING PLAYS and no player is touched: the module never loads the YouTube IFrame API, never calls playVideo / loadVideoById, imports nothing from the player, the playback state, the device or the WebSocket code", !/iframe_api/.test(lib) && !/playVideo|loadVideoById|cueVideoById/.test(lib) && !/from "@\/(lib|components)\/(playback|audio-player|device|remote|ws)/.test(lib));
assert("W2 only NUMBERS keyed by track id go to the server (the same route and helper the local-file reader uses): no url, no name", /saveLengths\(playlist\.id, batch\)/.test(lib) && !/JSON\.stringify\(\{[^}]*(url|name)/.test(lib.replace(/JSON\.stringify\(\{ event: "listening"[^)]*\)/, "")));
assert("W3 the hidden embed is always removed (finish() removes it and the listener and both timers) and only messages from YouTube's own window are believed", /frame\?\.remove\(\)/.test(lib) && /window\.removeEventListener\("message", onMessage\)/.test(lib) && /e\.origin !== YT_ORIGIN/.test(lib) && /e\.source !== frame\.contentWindow/.test(lib));
assert("W4 a video is never asked twice in a session (answers remembered), and a silent one is left alone for a while", /answered\.get\(id\)/.test(lib) && /failedAt\.get\(id\)/.test(lib) && /RETRY_AFTER_MS/.test(lib));
const loc = rd("lib/local-track-length.ts");
assert("W5 the shared save helper is the same one the local-file reader uses (exported, numbers only)", /export async function saveLengths\(playlistId: string, durations: Record<string, number>\)/.test(loc) && /import \{ saveLengths \} from "@\/lib\/local-track-length"/.test(lib));
const studio = rd("components/schedules-studio/schedules-studio.tsx");
const iProbe = studio.indexOf("learnYoutubeLengths(first)");
const iServer = studio.indexOf("/refresh-duration");
assert("W6 the Studio asks THIS browser first (a new YouTube song, a hidden embed, 0.3 - 1.2 s), only when the song has no length; the server lookup and the station's own file reader stay as fallbacks after it", iProbe > 0 && iServer > iProbe && /youtubeTracksMissingLength\(first\)\.length > 0/.test(studio) && /canProbeYoutubeLengths\(\)/.test(studio) && /learnLocalLengths\(pl\)/.test(studio));
assert("W7 never a sweep: the module has no timer that walks the library - it runs only for the playlist a person picks / drags", !/setInterval\([^)]*library|for \(const p of playlists\)/.test(lib) && /export function learnYoutubeLengths\(playlist: Playlist\)/.test(lib));

console.log(`\n${pass} passed, ${fail} failed`);
