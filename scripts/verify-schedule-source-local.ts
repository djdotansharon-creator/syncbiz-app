/**
 * A scheduled SOURCE block whose target is a LOCAL path (audit F2, 2026-11-21). runSchedulePlayback used to hand the song to the Player and THEN also POST the local
 * path to /api/commands/play-local — a route retired since Gate 3B-4a that only answers 410. Two harms: the path left the machine (CLAUDE.md §12), and the 410 made the
 * function return false, so the block was never marked started and the next 30 s poll played the song again from its start, over and over.
 * Now the path stays on the machine and the start counts as handed over. http(s) targets, a missing target and the station's "cloud not ready yet" wait are unchanged.
 * Fake handlers + a fake fetch that records every request; no network.
 * Run: npx tsx scripts/verify-schedule-source-local.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
(globalThis as unknown as { window: unknown }).window = { location: { origin: "https://app.test" } };
import { runSchedulePlayback } from "../lib/schedule-playback-client";
import type { Schedule, Source } from "../lib/types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sched = { id: "s1", accountId: "a", name: "Opening song", branchId: "default", targetType: "SOURCE", targetId: "src1", sourceId: "src1", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTimeLocal: "09:00:00", endTimeLocal: "10:00", enabled: true, priority: 1 } as Schedule;
const mkSource = (target: string, extra: Partial<Source> = {}) => ({ id: "src1", accountId: "a", branchId: "default", name: "Opening", type: "local_playlist", target, playerMode: "external", ...extra }) as unknown as Source;

const requests: { url: string; body: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: string, init?: { body?: string }) => { requests.push({ url: String(u), body: String(init?.body ?? "") }); return { ok: false, status: 410, json: async () => ({ error: "Gone" }) }; }) as never;

const calls: string[] = [];
const handlers = (extra: Record<string, unknown> = {}) => ({
  stop: () => calls.push("stop"),
  setQueue: () => calls.push("queue"),
  playSource: (s: { type: string; url: string }, i?: number) => calls.push(`play:${s.type}:${i}:${s.url}`),
  setLastMessage: (m: string | null) => { if (m) calls.push(`msg:${m}`); },
  ...extra,
});
const router = { push: (h: string) => calls.push(`push:${h}`) } as never;
const LOCAL = "C:/Music/Opening/song.mp3";

async function main() {
  calls.length = 0; requests.length = 0;
  let ok = await runSchedulePlayback(sched, mkSource(LOCAL), handlers({ route: { kind: "station", urlReady: false } }), router);
  assert("T1 the station starts a SOURCE with a local path ONCE (handed to the Player), counts as started (true) — even with the cloud down", ok && calls.length === 1 && calls[0] === `play:local:0:${LOCAL}`, calls.join("|"));
  assert("T2 NOTHING is sent to the server: no request at all, so the local path never leaves the machine (§12)", requests.length === 0, JSON.stringify(requests));

  calls.length = 0; requests.length = 0;
  ok = await runSchedulePlayback(sched, mkSource(LOCAL), handlers(), router);
  assert("T3 another window (browser / phone) behaves the same: one hand-over, true, no request — it no longer replays the song every poll", ok && calls.length === 1 && requests.length === 0, calls.join("|"));

  calls.length = 0; requests.length = 0;
  ok = await runSchedulePlayback(sched, mkSource("D:\\Playlists\\morning.m3u"), handlers({ route: { kind: "station", urlReady: true } }), router);
  assert("T4 a local playlist FILE (.m3u, Windows path) is the same: handed over once, true, no request", ok && calls.length === 1 && calls[0]!.startsWith("play:winamp:0:") && requests.length === 0, calls.join("|"));

  calls.length = 0; requests.length = 0;
  ok = await runSchedulePlayback(sched, mkSource("https://radio.example.com/live.mp3", { type: "stream-url" as never }), handlers(), router);
  assert("T5 an http(s) target is UNCHANGED: handed over once, true, no request", ok && calls.length === 1 && calls[0]!.startsWith("play:stream-url:0:") && requests.length === 0, calls.join("|"));

  calls.length = 0; requests.length = 0;
  ok = await runSchedulePlayback(sched, mkSource("https://radio.example.com/live.mp3", { type: "stream-url" as never }), handlers({ route: { kind: "station", urlReady: false } }), router);
  assert("T6 the station with the cloud not ready and a URL target is UNCHANGED: nothing starts, false (the next poll retries)", !ok && calls.length === 0 && requests.length === 0, calls.join("|"));

  calls.length = 0; requests.length = 0;
  ok = await runSchedulePlayback(sched, mkSource("   "), handlers(), router);
  assert("T7 a source with no target is UNCHANGED: false, says so", !ok && calls.some((c) => c.startsWith("msg:Failed: No target path")) && requests.length === 0, calls.join("|"));

  // ── static guards ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const src = readFileSync(path.join(__dirname, "..", "lib/schedule-playback-client.ts"), "utf-8").replace(/\r\n/g, "\n");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert("T8 the schedule engine's start path no longer mentions the retired play-local route, and never posts a target / path", !/play-local/.test(code) && !/browserPreference/.test(code) && !/body:\s*JSON\.stringify\(\{\s*target/.test(code));
  assert("T9 NOTHING playback-related was added: still no MPV / orchestrator / watchdog / provider import", !/mpv|orchestrator|watchdog|device-player|audio-player/i.test(code.split("\n").filter((l) => /^import /.test(l)).join("\n")));
  globalThis.fetch = realFetch;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
