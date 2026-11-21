/**
 * A scheduled block of a LOCAL playlist (2026-11-21). The server has accepted such a block since PR #222 ("the station checks playability at play time"), but
 * runSchedulePlayback refused every playlist with no http(s) url for EVERY window — the block never started and the engine retried silently each poll.
 * Now: the designated station's own window starts it exactly like a manual library click (queue + the accepted LOCAL path, never stops the current music
 * first, never needs the cloud); every other window keeps the old refusal (the station's files cannot play there — CLAUDE.md §12). Playlists that DO have an
 * http(s) url are untouched. Fake handlers + a fake fetch; no network.
 * Run: npx tsx scripts/verify-schedule-local-playlist.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
(globalThis as unknown as { window: unknown }).window = { location: { origin: "https://app.test" } };
import { runSchedulePlayback } from "../lib/schedule-playback-client";
import type { Schedule } from "../lib/types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sched = { id: "s1", accountId: "a", name: "YCD", branchId: "default", targetType: "PLAYLIST", targetId: "pl-local", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTimeLocal: "10:00:00", endTimeLocal: "12:00", enabled: true, priority: 1 } as Schedule;

const local3 = { id: "pl-local", name: "YCD", genre: "Mixed", type: "local", url: "C:/Music/YCD/a.mp3", thumbnail: "", tracks: [1, 2, 3].map((i) => ({ id: `t${i}`, name: `s${i}`, type: "local", url: `C:/Music/YCD/${["a", "b", "c"][i - 1]}.mp3` })) };
const winamp = { ...local3, id: "pl-winamp", type: "winamp" };
const noUrl = { ...local3, id: "pl-empty", url: "", tracks: [] };
const mixed = { id: "pl-mixed", name: "Mixed", genre: "Mixed", type: "local", url: "C:/Music/a.mp3", thumbnail: "", tracks: [{ id: "m1", name: "a", type: "local", url: "C:/Music/a.mp3" }, { id: "m2", name: "b", type: "youtube", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }] };
const yt = { id: "pl-yt", name: "YT", genre: "Mixed", type: "youtube", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", thumbnail: "", tracks: [{ id: "y1", name: "b", type: "youtube", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb" }] };
const byId: Record<string, unknown> = { "pl-local": local3, "pl-winamp": winamp, "pl-empty": noUrl, "pl-mixed": mixed, "pl-yt": yt };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: string) => {
  const id = decodeURIComponent(String(u).split("/api/playlists/")[1] ?? "");
  return byId[id] ? { ok: true, json: async () => byId[id] } : { ok: false, json: async () => ({ error: "nope" }) };
}) as never;

const calls: string[] = [];
const unifiedSeen: { type?: string; url?: string; origin?: string; id?: string; playlistId?: string }[] = [];
const handlers = (extra: Record<string, unknown> = {}) => ({
  stop: () => calls.push("stop"),
  setQueue: (s: { id: string }[], o?: { force?: boolean }) => calls.push(`queue:${s[0]?.id}:${o?.force ? "force" : "soft"}`),
  playSource: (s: { type: string; url: string; origin: string; id: string; playlist?: { id: string } }, i?: number) => { calls.push(`play:${s.type}:${i}`); unifiedSeen.push({ type: s.type, url: s.url, origin: s.origin, id: s.id, playlistId: s.playlist?.id }); },
  setLastMessage: (m: string | null) => { if (m) calls.push("msg"); },
  ...extra,
});
const router = { push: () => {} } as never;
const station = { kind: "station", urlReady: false } as const; // the cloud is NOT reachable: LOCAL must still start

async function main() {
  calls.length = 0; unifiedSeen.length = 0;
  let ok = await runSchedulePlayback(sched, null, handlers({ route: station }), router);
  assert("S1 the station's own window starts a LOCAL playlist exactly like a manual click: queue (forced) + play row 0, WITHOUT stopping the current music, even with the cloud down", ok && calls.length === 2 && calls[0]!.startsWith("queue:") && calls[0]!.endsWith(":force") && calls[1] === "play:local:0", calls.join("|"));
  assert("S2 what it plays is the playlist itself: type local, origin playlist, the first local file as url, the playlist id kept (the same shape the library click builds)", unifiedSeen[0]?.type === "local" && unifiedSeen[0]?.origin === "playlist" && unifiedSeen[0]?.url === "C:/Music/YCD/a.mp3" && unifiedSeen[0]?.playlistId === "pl-local", JSON.stringify(unifiedSeen[0]));

  calls.length = 0; unifiedSeen.length = 0;
  ok = await runSchedulePlayback({ ...sched, targetId: "pl-winamp" }, null, handlers({ route: { kind: "station", urlReady: true } }), router);
  assert("S3 a winamp playlist starts the same way on the station (its own type kept)", ok && unifiedSeen[0]?.type === "winamp" && calls.filter((c) => c === "stop").length === 0, calls.join("|"));

  calls.length = 0;
  ok = await runSchedulePlayback(sched, null, handlers(), router);
  assert("S4 a browser / phone / non-designated window still REFUSES it (false, says why, nothing starts, nothing stops) — the station's files cannot play there", !ok && calls.join("|") === "msg", calls.join("|"));

  calls.length = 0;
  ok = await runSchedulePlayback(sched, null, handlers({ route: { kind: "wait", reason: "station-deciding" } }), router);
  assert("S5 while the station is still deciding its role nothing starts (unchanged)", !ok && calls.length === 0, calls.join("|"));

  calls.length = 0;
  ok = await runSchedulePlayback({ ...sched, targetId: "pl-empty" }, null, handlers({ route: station }), router);
  assert("S6 a local playlist with no file at all still starts nothing and says so", !ok && calls.join("|") === "msg", calls.join("|"));

  calls.length = 0; unifiedSeen.length = 0;
  ok = await runSchedulePlayback({ ...sched, targetId: "pl-yt" }, null, handlers({ route: { kind: "station", urlReady: true } }), router);
  assert("S7 a YouTube playlist is UNCHANGED: still queue + play through the url path on the station", ok && unifiedSeen[0]?.type === "youtube" && calls[0]?.endsWith(":force"), calls.join("|"));
  calls.length = 0; unifiedSeen.length = 0;
  ok = await runSchedulePlayback({ ...sched, targetId: "pl-yt" }, null, handlers(), router);
  assert("S8 …and on a browser window it is still stop → queue → play row 0", ok && calls[0] === "stop" && calls[1]?.endsWith(":force") && calls[2] === "play:youtube:0", calls.join("|"));
  calls.length = 0; unifiedSeen.length = 0;
  ok = await runSchedulePlayback({ ...sched, targetId: "pl-mixed" }, null, handlers({ route: { kind: "station", urlReady: true } }), router);
  assert("S9 a playlist that has ANY http(s) url keeps the existing path (the new branch is only for playlists with none)", ok && unifiedSeen[0]?.type === "youtube", JSON.stringify(unifiedSeen[0]));

  // ── static guards ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const src = readFileSync(path.join(__dirname, "..", "lib/schedule-playback-client.ts"), "utf-8").replace(/\r\n/g, "\n");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const branch = code.slice(code.indexOf("if (!playlistHasHttpPlayableUrl(playlist))"), code.indexOf("const tracks = getPlaylistTracks(playlist);"));
  assert("S10 the new branch is station-only, local/winamp-only, goes through the ONE start() (no new playback call), and never posts a path anywhere", /route\.kind === "station"/.test(branch) && /playlist\.type === "local" \|\| playlist\.type === "winamp"/.test(branch) && /return start\(localUnified, 0\)/.test(branch) && !/fetch\(|stop\(\)|playSource\(/.test(branch));
  assert("S11 NOTHING else changed in the engine: no MPV / orchestrator / watchdog / provider import was added", !/mpv|orchestrator|watchdog|device-player|audio-player/i.test(code.split("\n").filter((l) => /^import /.test(l)).join("\n")));
  globalThis.fetch = realFetch;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
