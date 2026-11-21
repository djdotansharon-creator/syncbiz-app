/**
 * SCHEDULE START REFUSALS LEAVE A TRACE (2026-11-21, diagnostic only — no behaviour change). 2026-11-21 field test on the Lenovo: a block of a local playlist did not start,
 * and the engine logged NOTHING about why (a refused start just returned false and was retried every poll), so "never saw the block" and "refused to start it" could not be
 * told apart. Now each refusal writes ONE line per block and per reason: `[VONO schedule] "<name>" did NOT start — <why> (this window's route: <kind>…)`.
 * Fake handlers + a fake fetch + a recording console.warn; no network.
 * Run: npx tsx scripts/verify-schedule-refusal-log.ts
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
const mk = (id: string, targetId: string, name = "YCD") => ({ id, accountId: "a", name, branchId: "default", targetType: "PLAYLIST", targetId, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTimeLocal: "10:00:00", endTimeLocal: "12:00", enabled: true, priority: 1 }) as Schedule;
const local3 = { id: "pl-local", name: "YCD", genre: "Mixed", type: "local", url: "C:/Music/YCD/a.mp3", thumbnail: "", tracks: [1, 2].map((i) => ({ id: `t${i}`, name: `s${i}`, type: "local", url: `C:/Music/YCD/${i}.mp3` })) };
const yt = { id: "pl-yt", name: "YT", genre: "Mixed", type: "youtube", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", thumbnail: "", tracks: [{ id: "y1", name: "b", type: "youtube", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb" }] };
const byId: Record<string, unknown> = { "pl-local": local3, "pl-yt": yt };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: string) => { const id = decodeURIComponent(String(u).split("/api/playlists/")[1] ?? ""); return byId[id] ? { ok: true, json: async () => byId[id] } : { ok: false, json: async () => ({}) }; }) as never;
const warns: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
const handlers = (extra: Record<string, unknown> = {}) => ({ stop: () => {}, setQueue: () => {}, playSource: () => {}, setLastMessage: () => {}, ...extra });
const router = { push: () => {} } as never;
const lines = () => warns.filter((w) => w.includes("did NOT start"));

async function main() {
  const s1 = mk("sch-1", "pl-local");
  let ok = await runSchedulePlayback(s1, null, handlers(), router);
  assert("N1 a LOCAL playlist refused in a non-station window: still false, and ONE line says so, with the window's route", !ok && lines().length === 1 && /"YCD" did NOT start/.test(lines()[0]!) && /LOCAL playlist/.test(lines()[0]!) && /route: default/.test(lines()[0]!), lines().join(" | "));
  await runSchedulePlayback(s1, null, handlers(), router); await runSchedulePlayback(s1, null, handlers(), router);
  assert("N2 the engine retries every poll: the same refusal is NOT written again (no log flood)", lines().length === 1, String(lines().length));

  ok = await runSchedulePlayback(s1, null, handlers({ route: { kind: "station", urlReady: false } }), router);
  assert("N3 the same block on the designated station starts (true) and writes no refusal line", ok && lines().length === 1);
  await runSchedulePlayback(s1, null, handlers(), router);
  assert("N4 a success clears the memory: if it is refused again later, that is written again", lines().length === 2, String(lines().length));

  const s2 = mk("sch-2", "pl-yt", "Morning");
  ok = await runSchedulePlayback(s2, null, handlers({ route: { kind: "wait", reason: "station-deciding" } }), router);
  assert("N5 the station still deciding (route wait): false and one line that says so", !ok && lines().some((l) => /"Morning" did NOT start/.test(l) && /not yet said whether it is the designated player/.test(l) && /route: wait/.test(l)), lines().at(-1) ?? "");
  ok = await runSchedulePlayback(s2, null, handlers({ route: { kind: "station", urlReady: false } }), router);
  assert("N6 a YouTube playlist on the station with the cloud connection not ready: false and one line with 'cloud not ready'", !ok && /route: station, cloud not ready/.test(lines().at(-1) ?? "") && /youtube/.test(lines().at(-1) ?? ""), lines().at(-1) ?? "");
  ok = await runSchedulePlayback(s2, null, handlers({ route: { kind: "station", urlReady: true } }), router);
  assert("N7 and the same block starts (true) once the connection is ready — behaviour untouched", ok);

  // ── static guards ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  console.warn = realWarn; globalThis.fetch = realFetch;
  const src = readFileSync(path.join(__dirname, "..", "lib/schedule-playback-client.ts"), "utf-8").replace(/\r\n/g, "\n");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert("N8 the log only reads: the helper has no fetch / playback call, and every refusal path still returns false exactly as before", /function noteRefusal[\s\S]{0,420}console\.warn/.test(code) && !/function noteRefusal[^}]*\b(fetch|playSource|setQueue|stop)\(/.test(code));
  assert("N9 no MPV / orchestrator / watchdog / provider import was added", !/mpv|orchestrator|watchdog|device-player|audio-player/i.test(code.split("\n").filter((l) => /^import /.test(l)).join("\n")));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
