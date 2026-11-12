/**
 * A scheduled royalty-free MUSIC BANK (2026-11-12): runSchedulePlayback's BANK branch drives the same start() as a playlist / radio, plays the pack as the
 * Royalty-Free screen's Stream mode does (ephemeral playlist of token-free /api/media/<id> URLs), and waits (returns false → the next poll retries) while the
 * media token or the cloud route is not ready. Fake handlers; no network except the public catalog that ships with the app.
 * Run: npx tsx scripts/verify-schedule-bank-engine.ts
 */
(globalThis as unknown as { window: unknown }).window = { location: { origin: "https://app.test" } };
import { runSchedulePlayback } from "../lib/schedule-playback-client";
import type { Schedule } from "../lib/types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sched = { id: "s1", accountId: "a", name: "Dance", branchId: "default", targetType: "BANK", targetId: "dance", daysOfWeek: [6], startTimeLocal: "15:00:00", endTimeLocal: "23:59", enabled: true, priority: 1 } as Schedule;
const calls: string[] = [];
const handlers = (extra: Record<string, unknown> = {}) => ({
  stop: () => calls.push("stop"),
  setQueue: (s: { id: string; playlist?: { tracks?: unknown[] } }[]) => calls.push(`queue:${s[0]?.id}:${(s[0]?.playlist?.tracks?.length ?? 0) > 0 ? "tracks" : "none"}`),
  playSource: (s: { type: string }, i?: number) => calls.push(`play:${s.type}:${i}`),
  setLastMessage: (m: string | null) => { if (m) calls.push(`msg:${m}`); },
  ...extra,
});
const router = { push: () => {} } as never;

async function main() {
  calls.length = 0;
  let ok = await runSchedulePlayback(sched, null, handlers(), router);
  assert("B1 a browser / non-station window: stop → queue the pack → play its first song as a stream URL", ok && calls.join("|") === "stop|queue:ephemeral-local-folder:musicbank-dance-stream:tracks|play:stream-url:0", calls.join("|"));
  calls.length = 0;
  ok = await runSchedulePlayback(sched, null, handlers({ bankStreamReady: false }), router);
  assert("B2 the media token is not there yet: nothing starts (false → the next poll retries)", !ok && calls.length === 0);
  calls.length = 0;
  ok = await runSchedulePlayback(sched, null, handlers({ route: { kind: "station", urlReady: false } }), router);
  assert("B3 the station's own window with the cloud route not ready: nothing starts and the current music is not stopped", !ok && calls.length === 0);
  calls.length = 0;
  ok = await runSchedulePlayback(sched, null, handlers({ route: { kind: "station", urlReady: true } }), router);
  assert("B4 the station's own window, route ready: exactly a manual click — queue + play, without stopping first", ok && calls.join("|") === "queue:ephemeral-local-folder:musicbank-dance-stream:tracks|play:stream-url:0", calls.join("|"));
  calls.length = 0;
  ok = await runSchedulePlayback({ ...sched, targetId: "no-such-bank" }, null, handlers(), router);
  assert("B5 a bank that does not exist (or is not open to this business) starts nothing and says so", !ok && calls.length === 1 && calls[0]!.startsWith("msg:"), calls.join("|"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
