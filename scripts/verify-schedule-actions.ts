/**
 * Schedule engine decisions (owner 2026-11-11: a block can END at a time, a QUIET block / closing of the day, nothing resurrects after it). PURE checks of
 * lib/schedule-actions.ts — a whole simulated day, minute by minute, with the engine's "fired today" memory. Nothing here plays or stops anything.
 * Run: npx tsx scripts/verify-schedule-actions.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { decideScheduleAction, explicitEndMinutes, playingBlockAt, scheduleEndFireStorageKey, type ScheduleAction } from "../lib/schedule-actions";
import { scheduleAutoFireStorageKey } from "../lib/schedule-window";
import type { Schedule } from "../lib/types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const mk = (id: string, start: string, extra: Partial<Schedule> = {}): Schedule => ({
  id, accountId: "a", name: id, branchId: "default", targetType: "PLAYLIST", targetId: "pl-" + id, daysOfWeek: [1, 2, 3, 4, 5], startTimeLocal: start, endTimeLocal: "23:59", enabled: true, priority: 1, ...extra,
});
const WED = (h: number, m = 0) => new Date(2026, 10, 11, h, m, 0); // Wed 11 Nov 2026
const SAT = (h: number, m = 0) => new Date(2026, 10, 14, h, m, 0);

/** the engine as the app runs it: a poll every minute, acting on the decision and remembering the keys */
function runDay(schedules: Schedule[], from: [number, number], to: [number, number], opts: { fired?: Set<string>; skip?: Set<string>; date?: (h: number, m?: number) => Date } = {}) {
  const fired = opts.fired ?? new Set<string>();
  const date = opts.date ?? WED;
  const log: string[] = [];
  for (let t = from[0] * 60 + from[1]; t <= to[0] * 60 + to[1]; t++) {
    const now = date(Math.floor(t / 60), t % 60);
    const a: ScheduleAction = decideScheduleAction({ schedules, now, skipIds: opts.skip, hasFired: (k) => fired.has(k) });
    if (!a) continue;
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (a.kind === "start") { fired.add(a.fireKey); log.push(`${hhmm} start ${a.schedule.id}`); }
    else { a.fireKeys.forEach((k) => fired.add(k)); log.push(`${hhmm} stop(${a.reason}) ${a.schedule.id}`); }
  }
  return { log, fired };
}

const A = mk("A", "08:00:00"), B = mk("B", "12:00:00"), C = mk("C", "17:00:00");
const day = runDay([A, B, C], [6, 0], [23, 59]);
assert("E1 an ordinary day: each block starts once, at its own minute, and nothing else ever happens", day.log.join() === "08:00 start A,12:00 start B,17:00 start C", day.log.join());
assert("E2 the weekend is quiet for weekday blocks", runDay([A, B, C], [6, 0], [23, 59], { date: SAT }).log.length === 0);

const mid = runDay([A, B, C], [13, 0], [13, 10]);
assert("E3 the app opens at 13:00 and nothing fired yet: the RIGHT block (B) starts once — the earlier, never-fired A does not start over it on the next poll", mid.log.join() === "13:00 start B", mid.log.join());

const Q = mk("Q", "22:00:00", { targetType: "SILENCE", targetId: "silence", name: "Closing" });
const closed = runDay([A, B, C, Q], [6, 0], [23, 59]);
assert("E4 a quiet block at 22:00 stops the music once, at 22:00, and the day is silent after it", closed.log.join() === "08:00 start A,12:00 start B,17:00 start C,22:00 stop(silence) Q", closed.log.join());
const afterRestart = runDay([A, B, C, Q], [22, 30], [23, 30]);
assert("E5 the app opens at 22:30 (after closing): it only stops (once) — no earlier block starts music in the quiet period", afterRestart.log.join() === "22:30 stop(silence) Q", afterRestart.log.join());

const BE = mk("B", "12:00:00", { endTimeLocal: "17:56:00" });
const C2 = mk("C", "19:00:00");
const ended = runDay([A, BE, C2], [6, 0], [23, 59]);
assert("E6 a block with an end (12:00 → 17:56): the music stops at 17:56 exactly (an end is exclusive), once; the next block starts at its own time", ended.log.join() === "08:00 start A,12:00 start BE".replace("BE", "B") + ",17:56 stop(end) B,19:00 start C", ended.log.join());
const handover = runDay([A, mk("B", "12:00:00", { endTimeLocal: "17:00:00" }), C], [6, 0], [23, 59]);
assert("E7 when the next block starts at the very minute the first one ends, the next one just starts — no stop in between", handover.log.join() === "08:00 start A,12:00 start B,17:00 start C", handover.log.join());
const neverStarted = runDay([A, BE, C2], [17, 57], [18, 30]);
assert("E8 a block with an end that was never started today (the app was closed) is never stopped, and the earlier block A does not fall back in", neverStarted.log.length === 0, neverStarted.log.join());
const restartLate = runDay([A, BE], [23, 0], [23, 30], { fired: new Set([scheduleAutoFireStorageKey(BE, WED(12))]) });
assert("E9 a restart long after the end (23:00, the end was 17:56) does not stop anything any more", restartLate.log.length === 0, restartLate.log.join());
const opted = runDay([A, B, C], [12, 0], [12, 30], { skip: new Set(["B"]), fired: new Set([scheduleAutoFireStorageKey(A, WED(8))]) });
assert("E10 a block switched off on this computer: it does not start, and the block that already played this morning does not start again in its place", opted.log.length === 0, opted.log.join());

const tie = runDay([mk("M", "21:00:00"), mk("Q2", "21:00:00", { targetType: "SILENCE", targetId: "silence", priority: 5 })], [21, 0], [21, 5]);
assert("E11 a music block and a quiet block with the same start: the better priority (lower number) decides", tie.log.join() === "21:00 start M", tie.log.join());
assert("E12 explicitEndMinutes: the default 23:59, an empty value and an end that is not after the start mean 'until the next block'; a real end is read", explicitEndMinutes(mk("x", "12:00:00")) === null && explicitEndMinutes(mk("x", "12:00:00", { endTimeLocal: "" })) === null && explicitEndMinutes(mk("x", "12:00:00", { endTimeLocal: "11:00:00" })) === null && explicitEndMinutes(mk("x", "12:00:00", { endTimeLocal: "17:56:00" })) === 17 * 60 + 56);
const once = new Set<string>([scheduleAutoFireStorageKey(BE, WED(12)), scheduleEndFireStorageKey(BE, WED(17, 56))]);
assert("E13 the end key and the start key are separate and per day", scheduleEndFireStorageKey(BE, WED(17, 56)) !== scheduleAutoFireStorageKey(BE, WED(12)) && scheduleEndFireStorageKey(BE, WED(17, 56)) !== scheduleEndFireStorageKey(BE, SAT(17, 56)) && runDay([A, BE, C2], [17, 56], [18, 30], { fired: once }).log.length === 0);

const qFired = new Set<string>([scheduleAutoFireStorageKey(Q, WED(22))]);
const re1 = decideScheduleAction({ schedules: [A, B, C, Q], now: WED(22, 40), hasFired: (k) => qFired.has(k), reassertSilence: true });
const re2 = decideScheduleAction({ schedules: [A, B, C, Q], now: WED(22, 40), hasFired: (k) => qFired.has(k) });
assert("E17 after a restart inside a quiet period the quiet is asserted once (restored music must not play on after closing); an ordinary poll does nothing", re1?.kind === "stop" && re1.reason === "silence" && re2 === null);
const playing = (h: number, m: number) => playingBlockAt([A, BE, C2, Q], WED(h, m))?.id ?? "-";
assert("E18 what should be playing: A → B (until 17:56) → silence → C from 19:00 → silence from 22:00", playing(9, 0) === "A" && playing(13, 0) === "B" && playing(17, 55) === "B" && playing(17, 56) === "-" && playing(18, 30) === "-" && playing(19, 0) === "C" && playing(22, 0) === "-" && playing(7, 0) === "-");

// ── wiring (static) ──
const ap = rd("components/schedule-auto-player.tsx");
assert("E14 the auto player acts on the decision: start as before, stop through the Stop button's own path (stopScheduled = stopOrSend), keys remembered", /decideScheduleAction\(/.test(ap) && /action\.kind === "stop"/.test(ap) && /stopScheduled/.test(ap) && /localStorage\.setItem\(k, "1"\)/.test(ap));
const hk = rd("lib/use-schedule-playback-handlers.ts");
assert("E15 stopScheduled is the Stop button's path on a station / controller (device.stopOrSend), else the plain stop", /const stopOrSend = device\?\.stopOrSend/.test(hk) && /const stopScheduled = stopOrSend \?\? stop/.test(hk));
assert("E16 the type, the validator and the create route know the quiet block (SILENCE) and nothing else changed in the playback code", /"SILENCE"/.test(rd("lib/types.ts")) && /targetType === "SILENCE"\) return \{ ok: true \}/.test(rd("lib/schedule-target-validator.ts")) && /targetType === "SILENCE" \? "silence"/.test(rd("app/api/schedules/route.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
