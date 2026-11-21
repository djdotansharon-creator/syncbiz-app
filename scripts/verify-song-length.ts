/**
 * SONG LENGTH (owner 2026-11-21: "I can only shorten a song in the schedule, never stretch it back"; "every song loaded from the computer must be saved with how long it is").
 *   · pure rules: the lengths a station reports (numbers keyed by track id) are cleaned and put only on songs that have none (lib/playlist-duration.ts);
 *   · the station-side reader (lib/local-track-length.ts) reads each local file's real length through the desktop's existing tag call, ONE file at a time, and sends ONLY numbers (never a path — §12);
 *   · the server route stores them with the playlist's own access rule; the Studio lookup and the three places that load local music into the library use the reader;
 *   · nothing here touches playback (no MPV / orchestrator / player imports) — static guards.
 * Run: npx tsx scripts/verify-song-length.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_REPORTED_TRACKS, MAX_REPORTED_TRACK_SECONDS, applyTrackDurations, playlistTotalSeconds, sanitizeTrackDurations } from "../lib/playlist-duration";
import { learnLocalLengths, localTracksMissingLength } from "../lib/local-track-length";
import type { Playlist } from "../lib/playlist-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

// ── pure rules ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const clean = sanitizeTrackDurations({ a: 215.4, b: 0, c: -5, d: "180", e: Number.NaN, f: 30 * 3600, g: 1, "": 60, h: Infinity, i: MAX_REPORTED_TRACK_SECONDS });
assert("L1 a reported length is kept only when it is a whole, plausible figure (1 second … 12 hours), rounded; zero, negative, text, NaN, Infinity, too long and an empty id are dropped", JSON.stringify(clean) === JSON.stringify({ a: 215, g: 1, i: MAX_REPORTED_TRACK_SECONDS }), JSON.stringify(clean));
assert("L2 anything that is not an object of numbers gives nothing (null, text, a list)", Object.keys(sanitizeTrackDurations(null)).length === 0 && Object.keys(sanitizeTrackDurations("x")).length === 0 && Object.keys(sanitizeTrackDurations([1, 2, 3])).length === 0 && Object.keys(sanitizeTrackDurations(undefined)).length === 0);
const many = Object.fromEntries(Array.from({ length: MAX_REPORTED_TRACKS + 50 }, (_, i) => [`t${i}`, 100]));
assert("L3 at most MAX_REPORTED_TRACKS lengths are taken in one report", Object.keys(sanitizeTrackDurations(many)).length === MAX_REPORTED_TRACKS);

const trks = [{ id: "a", durationSeconds: 200 }, { id: "b" }, { id: "c", durationSeconds: null }, { id: "d", durationSeconds: 0 }];
const ap = applyTrackDurations(trks, { a: 999, b: 180, c: 240, x: 50 });
assert("L4 a reported length goes only to songs that have none; a known length is never overwritten; unknown ids are ignored; `applied` counts them", ap.applied === 2 && ap.tracks[0]!.durationSeconds === 200 && ap.tracks[1]!.durationSeconds === 180 && ap.tracks[2]!.durationSeconds === 240 && ap.tracks[3]!.durationSeconds === 0, JSON.stringify(ap));
assert("L5 the playlist's total is the SUM once every song is known — and not a partial sum before that", playlistTotalSeconds(ap.tracks) === null && playlistTotalSeconds(applyTrackDurations(ap.tracks, { d: 100 }).tracks) === 200 + 180 + 240 + 100);
assert("L6 nothing to apply = the same songs back, applied 0", applyTrackDurations(trks, {}).applied === 0 && applyTrackDurations(trks, { zz: 10 }).applied === 0);

// ── the station-side reader ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const pl = (extra: Partial<Playlist> & { id: string }): Playlist => ({ name: "p", url: "C:/m/a.mp3", type: "local", genre: "x", thumbnail: "", createdAt: "", ...extra } as unknown as Playlist);
const mixed = pl({ id: "p1", tracks: [
  { id: "t1", name: "one", type: "local", url: "C:/m/one.mp3" },
  { id: "t2", name: "two", type: "local", url: "C:/m/two.mp3", durationSeconds: 200 },
  { id: "t3", name: "three", type: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk" },
  { id: "t4", name: "four", type: "local", url: "C:/m/four.mp3" },
] as unknown as Playlist["tracks"] });
assert("L7 only LOCAL songs with no length are read (a known one and a YouTube one are not)", localTracksMissingLength(mixed).map((t) => t.id).join() === "t1,t4");
const single = pl({ id: "solo", url: "C:/m/solo.mp3" });
assert("L8 a one-song local playlist with no stored track list is the song (its track id is the playlist's id)", localTracksMissingLength(single).map((t) => t.id).join() === "solo");
assert("L9 a one-song playlist whose length is stored needs nothing", localTracksMissingLength(pl({ id: "solo2", url: "C:/m/s.mp3", durationSeconds: 180 })).length === 0);

type Call = { url: string; body: string };
const g = globalThis as unknown as { window?: unknown; fetch?: unknown };
const realWindow = g.window;
const realFetch = g.fetch;
async function run(files: Record<string, number | "error" | "outside">, playlist: Playlist, serverTotal: (n: number) => number | null): Promise<{ total: number | null; reads: string[]; calls: Call[]; maxParallel: number }> {
  const reads: string[] = [];
  const calls: Call[] = [];
  let parallel = 0, maxParallel = 0;
  g.window = {
    setTimeout,
    syncbizDesktop: {
      getLocalAudioTags: async (p: string) => {
        parallel++; maxParallel = Math.max(maxParallel, parallel);
        reads.push(p);
        await new Promise((r) => setTimeout(r, 2));
        parallel--;
        const v = files[p];
        if (v === "error") throw new Error("boom");
        if (v === "outside" || v === undefined) return { status: "error", message: "File is not inside an approved music folder." };
        return { status: "ok", tags: { durationSec: v } };
      },
    },
  };
  let applied = 0;
  g.fetch = async (url: string, init: { body: string }) => {
    calls.push({ url, body: init.body });
    applied += Object.keys((JSON.parse(init.body) as { durations: Record<string, number> }).durations).length;
    return { ok: true, json: async () => ({ durationSeconds: serverTotal(applied), applied, stillMissing: 0 }) };
  };
  const total = await learnLocalLengths(playlist);
  g.window = realWindow; g.fetch = realFetch;
  return { total, reads, calls, maxParallel };
}

void (async () => {
  const r1 = await run({ "C:/m/one.mp3": 215.6, "C:/m/four.mp3": 180 }, mixed, (n) => (n >= 2 ? 215 + 200 + 180 : null));
  assert("L10 the reader reads each local file's real length, ONE file at a time, and answers the playlist's total from the server's answer", r1.reads.join() === "C:/m/one.mp3,C:/m/four.mp3" && r1.maxParallel === 1 && r1.total === 215 + 200 + 180, JSON.stringify({ total: r1.total, reads: r1.reads, par: r1.maxParallel }));
  const body = r1.calls.map((c) => c.body).join("|");
  assert("L11 ONLY numbers keyed by track id are sent — never a path, a name or a url (CLAUDE.md §12)", r1.calls.length === 1 && r1.calls[0]!.url === "/api/playlists/p1/track-durations" && JSON.parse(r1.calls[0]!.body).durations.t1 === 216 && JSON.parse(r1.calls[0]!.body).durations.t4 === 180 && Object.keys(JSON.parse(r1.calls[0]!.body)).join() === "durations" && !/C:|\.mp3|\\\\|\//.test(body.replace(/\d+/g, "")), body);
  const r2 = await run({ "C:/m/one.mp3": "error", "C:/m/four.mp3": "outside" }, mixed, () => null);
  assert("L12 a file that cannot be read (outside the approved folders, moved, an error) stays unknown: nothing is sent, no total, no crash", r2.total === null && r2.calls.length === 0 && r2.reads.length === 2);
  const r3 = await run({ "C:/m/one.mp3": 100, "C:/m/four.mp3": "outside" }, mixed, () => null);
  assert("L13 the files that could be read are saved even when another could not (the total stays unknown)", r3.calls.length === 1 && Object.keys(JSON.parse(r3.calls[0]!.body).durations).join() === "t1" && r3.total === null);
  const r4 = await run({ "C:/m/solo.mp3": 233.2 }, single, (n) => (n >= 1 ? 233 : null));
  assert("L14 a one-song local playlist: the song's length is saved under the playlist's id and is its total", r4.total === 233 && JSON.parse(r4.calls[0]!.body).durations.solo === 233);

  g.window = {}; // a browser / phone: no desktop
  let touched = false;
  g.fetch = async () => { touched = true; return { ok: true, json: async () => ({}) }; };
  const none = await learnLocalLengths(mixed);
  g.window = realWindow; g.fetch = realFetch;
  assert("L15 outside the desktop app (a browser, the phone) the reader answers null and does nothing", none === null && !touched);

  // two askers at the same moment share one run
  g.window = { setTimeout, syncbizDesktop: { getLocalAudioTags: async () => { await new Promise((r) => setTimeout(r, 5)); return { status: "ok", tags: { durationSec: 100 } }; } } };
  let fetches = 0;
  g.fetch = async () => { fetches++; return { ok: true, json: async () => ({ durationSeconds: null, applied: 2, stillMissing: 0 }) }; };
  const [x, y] = await Promise.all([learnLocalLengths(mixed), learnLocalLengths(mixed)]);
  g.window = realWindow; g.fetch = realFetch;
  assert("L16 two askers for the same playlist share one run (one save, never a double read)", fetches === 1 && x === y);

  // ── static guards ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const route = rd("app/api/playlists/[id]/track-durations/route.ts");
  assert("L17 the route uses the playlist's own access gate (same as PUT / refresh-duration), takes ONLY `durations` (numbers by track id), never answers with a track list or a path", /gatePlaylistAccess\(user \?\? null, playlist\)/.test(route) && /sanitizeTrackDurations\(/.test(route) && /applyTrackDurations\(/.test(route) && !/NextResponse\.json\(\{[^}]*\b(url|tracks|path|name)\s*:/.test(route) && !/body\.(url|path|tracks)/.test(route));
  assert("L18 the route fills only songs with no length and keeps the playlist's order (the same update the refresh-duration route makes)", /updatePlaylist\(id, \{ tracks: next, order: playlist\.order \}\)/.test(route) && /updatePlaylist\(id, \{ durationSeconds: sec \}\)/.test(route));
  const helper = rd("lib/local-track-length.ts");
  assert("L19 the reader goes through the desktop's existing tag call, one file at a time with a breath between two, saves in chunks, and sends `{ durations }` only", /getLocalAudioTags/.test(helper) && /for \(const t of todo\)/.test(helper) && /await read\(t\.url\)/.test(helper) && /BREATH_MS/.test(helper) && /CHUNK/.test(helper) && /JSON\.stringify\(\{ durations \}\)/.test(helper));
  assert("L20 NOTHING here touches playback: the reader and the route import no player, provider, MPV, orchestrator or watchdog code", !/playback-provider|device-player|audio-player|orchestrator|mpv|watchdog|syncbizDesktop\.(play|stop|seek|next)/i.test(helper.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")) && !/playback-provider|device-player|audio-player|orchestrator|mpv|watchdog/i.test(route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  const studio = rd("components/schedules-studio/schedules-studio.tsx");
  assert("L21 the Studio's length lookup asks the server first (YouTube) and then lets THIS station read its local files; a drop does not wait for it (the true length comes in later)", /refresh-duration/.test(studio) && /canReadLocalLengths\(\) && localTracksMissingLength\(pl\)\.length > 0/.test(studio) && /await learnLocalLengths\(pl\)/.test(studio) && /const playlistsRef = useRef\(playlists\)/.test(studio) && /LOOKUP_WAIT_MS/.test(studio));
  const lia = rd("components/library-input-area.tsx");
  const lmp = rd("lib/local-music-library-playlist.ts");
  assert("L22 every place that loads local music into the library saves its lengths: the folder, the single file (paste / drop), and the My Music scan + file creators", (lia.match(/void learnLocalLengths\(created\)/g) ?? []).length === 2 && (lmp.match(/void learnLocalLengths\(created\)/g) ?? []).length === 2);

  console.log(`\n${pass} passed, ${fail} failed`);
})();
