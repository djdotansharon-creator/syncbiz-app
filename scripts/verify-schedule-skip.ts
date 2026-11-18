/**
 * The father's four notes (2026-11-18): (1) a block's start must really start the music, (2) a stop ends with a 9-second fade-out, (3) ONE block can be switched off for ONE day ("then the 8:00 playlist
 * plays on until the 18:00 one"), (4) music a person chose in the middle of the day plays on until the next block. PURE checks of lib/schedule-skip.ts, schedule-actions.ts, schedule-fade.ts,
 * schedule-start-retry.ts, schedules-timeline.ts + static wiring checks. Nothing here plays or stops anything.
 * Run: npx tsx scripts/verify-schedule-skip.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { currentBlockAt, decideScheduleAction, playingBlockAt, type ScheduleAction } from "../lib/schedule-actions";
import { SKIP_MAX, isSkippedOn, isYmd, normalizeSkipDates, skipDatesFromTags, tagsWithSkipDates, withSkipDate, ymdOf } from "../lib/schedule-skip";
import { FADE_OUT_MS, fadeOutLevels, shouldFadeStop } from "../lib/schedule-fade";
import { START_CHECK_AFTER_MS, START_MAX_TRIES, decideStartCheck } from "../lib/schedule-start-retry";
import { buildDayScenes, weekDatesFor } from "../lib/schedules-timeline";
import type { Schedule } from "../lib/types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const mk = (id: string, start: string, extra: Partial<Schedule> = {}): Schedule => ({
  id, accountId: "a", name: id, branchId: "default", targetType: "PLAYLIST", targetId: "pl-" + id, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTimeLocal: start, endTimeLocal: "23:59", enabled: true, priority: 1, ...extra,
});
const WED = (h: number, m = 0) => new Date(2026, 10, 18, h, m, 0); // Wed 18 Nov 2026
const THU = (h: number, m = 0) => new Date(2026, 10, 19, h, m, 0);
const TODAY = "2026-11-18";

function runDay(schedules: Schedule[], from: number, to: number, date: (h: number, m?: number) => Date = WED): string[] {
  const fired = new Set<string>();
  const log: string[] = [];
  for (let t = from; t <= to; t++) {
    const now = date(Math.floor(t / 60), t % 60);
    const a: ScheduleAction = decideScheduleAction({ schedules, now, hasFired: (k) => fired.has(k) });
    if (!a) continue;
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (a.kind === "start") { fired.add(a.fireKey); log.push(`${hhmm} start ${a.schedule.id}`); }
    else if (a.kind === "adopt") { fired.add(a.fireKey); log.push(`${hhmm} adopt ${a.schedule.id}`); }
    else { a.fireKeys.forEach((k) => fired.add(k)); log.push(`${hhmm} stop ${a.schedule.id}`); }
  }
  return log;
}

// ── note 3: one block off for one day ──
const A = mk("A", "08:00:00"), B = mk("B", "14:00:00"), C = mk("C", "18:00:00");
const Boff = { ...B, skipDates: [TODAY] };
assert("K1 three blocks, the 14:00 one switched off TODAY: the 8:00 block starts, the 14:00 one never does, the 18:00 one starts — nothing else happens", runDay([A, Boff, C], 6 * 60, 23 * 60 + 59).join() === "08:00 start A,18:00 start C");
assert("K2 the switch-off is for that date only: the next day the 14:00 block plays as ever", runDay([A, Boff, C], 6 * 60, 23 * 60 + 59, THU).join() === "08:00 start A,14:00 start B,18:00 start C");
assert("K3 at 15:00 the block in force is the 8:00 one (it plays on until the 18:00 one), not the skipped one", currentBlockAt([A, Boff, C], WED(15))?.id === "A" && playingBlockAt([A, Boff, C], WED(15))?.id === "A");
assert("K4 without the switch-off the same hour belongs to the 14:00 block", currentBlockAt([A, B, C], WED(15))?.id === "B");
const Qoff = mk("Q", "22:00:00", { targetType: "SILENCE", targetId: "silence", name: "Closing", skipDates: [TODAY] });
assert("K5 a quiet (closing) block can be switched off for a day too: no stop that evening", runDay([A, C, Qoff], 17 * 60, 23 * 60 + 59).join() === "17:00 start A,18:00 start C" && runDay([A, C, { ...Qoff, skipDates: undefined }], 17 * 60, 23 * 60 + 59).join() === "17:00 start A,18:00 start C,22:00 stop Q");

const week = weekDatesFor(WED(12));
const dayIdx = WED(12).getDay();
const sc = buildDayScenes([A, Boff, C], dayIdx, week);
const sA = sc.find((s) => s.schedule.id === "A")!, sB = sc.find((s) => s.schedule.id === "B")!;
assert("K6 the day board / studio: the switched-off block is drawn paused (and marked off for the day) and the 8:00 block runs through to 18:00", sB.paused === true && sB.offDay === true && sA.end === 18 * 60 && !sA.paused);
const scOther = buildDayScenes([A, Boff, C], (dayIdx + 1) % 7, weekDatesFor(THU(12)));
assert("K7 the next day the block is on the board as usual", scOther.find((s) => s.schedule.id === "B")!.paused === false && scOther.find((s) => s.schedule.id === "A")!.end === 14 * 60);
const dis = buildDayScenes([A, { ...B, enabled: false }, C], dayIdx, week).find((s) => s.schedule.id === "B")!;
assert("K8 a block that is switched off for ALL days is paused but not marked 'off for the day'", dis.paused === true && dis.offDay === undefined);

// ── the list, the tags, the request ──
assert("K9 switching a day off / on: sorted, no duplicates, past dates dropped", withSkipDate(["2026-11-20", "2026-11-01"], "2026-11-18", true, TODAY).join() === "2026-11-18,2026-11-20" && withSkipDate(["2026-11-18"], "2026-11-18", false, TODAY).length === 0 && withSkipDate(undefined, "2026-11-18", true, TODAY).join() === "2026-11-18");
assert("K10 only real dates count (2026-02-30, text, numbers are not dates)", isYmd("2026-11-18") && !isYmd("2026-02-30") && !isYmd("18/11/2026") && !isYmd(20261118) && !isYmd(""));
const tags = [{ key: "genre", value: "jazz" }, { key: "skip-date", value: "2026-11-18" }, { key: "skip-date", value: "not-a-date" }, { key: "skip-date", value: "2026-11-18" }];
assert("K11 the dates are read out of the block's tags (valid, unique); other tags are not dates", skipDatesFromTags(tags).join() === "2026-11-18" && skipDatesFromTags(null).length === 0 && skipDatesFromTags("x").length === 0);
const rewritten = tagsWithSkipDates(tags, ["2026-11-19", "2026-11-10", "2026-11-17"], TODAY);
assert("K12 the server rewrites only the skip tags: the other tags stay, dates older than two days are dropped (time-zone margin), the rest are kept in order", rewritten.map((t) => `${t.key}=${t.value}`).join() === "genre=jazz,skip-date=2026-11-17,skip-date=2026-11-19");
assert("K13 no dates left → no skip tags (the other tags remain; none at all = an empty list)", tagsWithSkipDates(tags, [], TODAY).map((t) => t.key).join() === "genre" && tagsWithSkipDates(null, [], TODAY).length === 0);
assert("K14 a request: absent → undefined; null → clear; a list of dates → cleaned; anything else → invalid", normalizeSkipDates(undefined) === undefined && (normalizeSkipDates(null) as string[]).length === 0 && (normalizeSkipDates(["2026-11-19", "2026-11-19", "2026-11-18"]) as string[]).join() === "2026-11-18,2026-11-19" && normalizeSkipDates("2026-11-18") === "invalid" && normalizeSkipDates(["x"]) === "invalid" && normalizeSkipDates(new Array(SKIP_MAX + 1).fill("2026-11-18")) === "invalid");
assert("K15 isSkippedOn / ymdOf", isSkippedOn(Boff, ymdOf(WED(1))) && !isSkippedOn(Boff, ymdOf(THU(1))) && !isSkippedOn(B, TODAY) && !isSkippedOn(Boff, undefined));

// ── note 4: a window opened in the middle of a block does not play over music ──
const at = (h: number, m: number, watch?: { sinceMin: number; audible: boolean | null }, fired: Set<string> = new Set()): ScheduleAction => decideScheduleAction({ schedules: [A, B, C], now: WED(h, m), hasFired: (k) => fired.has(k), watch });
const opened = 15 * 60; // the window began to watch at 15:00; the 14:00 block was in force long before
assert("W1 a controller window opened at 15:00 with music playing: the 14:00 block is only adopted (marked), nothing is played over the person's music", at(15, 0, { sinceMin: opened, audible: true })?.kind === "adopt");
assert("W2 …with silence: the block starts, as ever (a station that came up silent still gets its music)", at(15, 0, { sinceMin: opened, audible: false })?.kind === "start");
assert("W3 …with the player's state not known yet: it waits (no action), the next poll decides", at(15, 0, { sinceMin: opened, audible: null }) === null);
assert("W4 a block that begins WHILE the window is open starts even when music plays (the schedule takes over at its time, as ever)", at(14, 0, { sinceMin: 13 * 60, audible: true })?.kind === "start" && at(14, 1, { sinceMin: 14 * 60, audible: true })?.kind === "start");
assert("W5 the player's own window (no `watch`) behaves exactly as before: the block in force starts", at(15, 0)?.kind === "start");
assert("W6 a block already marked today is left alone in every case", at(15, 0, { sinceMin: opened, audible: true }, new Set([`syncbiz-schedule-auto-B-2026-11-18-14:00:00`])) === null);
const longDay = (() => {
  const fired = new Set<string>();
  const log: string[] = [];
  for (let t = 8 * 60; t <= 19 * 60; t++) {
    const a = decideScheduleAction({ schedules: [A, B, C], now: WED(Math.floor(t / 60), t % 60), hasFired: (k) => fired.has(k), watch: { sinceMin: 8 * 60, audible: true } });
    if (a?.kind === "start") { fired.add(a.fireKey); log.push(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} ${a.schedule.id}`); }
  }
  return log.join();
})();
assert("W7 a controller window that has been open since the morning still starts every block at its own minute (only a window opened INSIDE a block holds back)", longDay === "8:00 A,14:00 B,18:00 C", longDay);

// ── note 2: the 9-second fade-out ──
const lv = fadeOutLevels(60);
assert("F1 the fade brings the volume from 60 down to 0 in small falling steps over 9 seconds", FADE_OUT_MS === 9000 && lv[lv.length - 1] === 0 && lv.every((v, i) => i === 0 || v < lv[i - 1]!) && lv[0]! < 60 && lv.length >= 15 && lv.length <= 20, lv.join(","));
assert("F2 a quiet player (0) or an unknown volume has nothing to fade", fadeOutLevels(0).length === 0 && fadeOutLevels(Number.NaN).length === 0);
const ok = { firstLook: false, tryNo: 1, audible: true, volume: 40, canSetVolume: true };
assert("F3 the first try of a stop of music that plays fades", shouldFadeStop(ok));
assert("F4 no fade at the first look after a restart, on a repeated try, with nothing playing, no volume, or no way to set it", !shouldFadeStop({ ...ok, firstLook: true }) && !shouldFadeStop({ ...ok, tryNo: 2 }) && !shouldFadeStop({ ...ok, audible: false }) && !shouldFadeStop({ ...ok, volume: null }) && !shouldFadeStop({ ...ok, volume: 0 }) && !shouldFadeStop({ ...ok, canSetVolume: false }));

// ── note 1: a start must really start the music ──
const w = (tries: number, at = 0) => ({ key: "k", at, tries });
const chk = (tries: number, ageMs: number, status: "playing" | "paused" | "idle" | "stopped" | null, stillCurrent = true) => decideStartCheck({ watch: w(tries), now: ageMs, status, stillCurrent });
assert("R1 too early to judge (a YouTube playlist can take ~8 s to begin): wait", chk(1, START_CHECK_AFTER_MS - 1, "idle") === "wait");
assert("R2 a poll later the music plays → the start worked; a person's pause also counts as worked", chk(1, START_CHECK_AFTER_MS, "playing") === "ok" && chk(1, START_CHECK_AFTER_MS, "paused") === "ok");
assert("R3 a poll later the player is SILENT → the start is repeated (into silence only)", chk(1, START_CHECK_AFTER_MS, "idle") === "retry" && chk(2, START_CHECK_AFTER_MS, "stopped") === "retry");
assert("R4 after three starts in all it gives up (it never fights a person for long)", START_MAX_TRIES === 3 && chk(3, START_CHECK_AFTER_MS, "idle") === "give-up");
assert("R5 the player's state not known (a station whose first status has not arrived) is never taken for silence: it waits, and drops the watch after five minutes", chk(1, START_CHECK_AFTER_MS * 2, null) === "wait" && chk(1, 5 * 60_000, null) === "give-up");
assert("R6 another block (or a quiet one) has taken over: the old start is not checked any more", chk(1, START_CHECK_AFTER_MS, "idle", false) === "ok");

// ── wiring (static) ──
const eng = rd("components/schedule-auto-player.tsx");
assert("X1 the engine checks a start (decideStartCheck), repeats it by clearing the key only into silence, and watches the new start", /decideStartCheck\(/.test(eng) && /localStorage\.removeItem\(sw\.key\)/.test(eng) && /startWatch\.current = \{ key: fireKey/.test(eng));
assert("X2 the engine fades the first try of a quiet stop and puts the volume back only after the music is quiet; a fade that never finished is given back at the next start", /shouldFadeStop\(/.test(eng) && /fadeOutLevels\(/.test(eng) && /giveBackVolume\(\); \/\/ the volume is put back only now/.test(eng) && /readFadeRestore\(\)/.test(eng));
assert("X3 the engine adopts a block (marks it, plays nothing) only for a window that controls another player", /action\.kind === "adopt"/.test(eng) && /controlsAnotherPlayer\?\.\(\)/.test(eng) && /watch = \{ sinceMin: ws\.min/.test(eng));
assert("X3b a browser window that has only just opened waits for the cloud socket before it looks (never the station's own window); the phone app (/mobile) is a remote and runs no schedule of its own", /WINDOW_SETTLE_MS/.test(eng) && /route\?\.kind !== "station" && Date\.now\(\) - \(watchState\.current\?\.at \?\? 0\) < WINDOW_SETTLE_MS/.test(eng) && /const PHONE_APP = \/\^\\\/mobile\(\\\/\|\$\)\//.test(eng) && /if \(isPhoneApp\) return;/.test(eng));
const hk = rd("lib/use-schedule-playback-handlers.ts");
assert("X4 a station's / controller's status that has not arrived is null (unknown), not 'idle'; only a controller that is not the station's own window holds back", /controlsAnother \? \(masterStatus \?\? null\) : \(providerStatus \?\? null\)/.test(hk) && /deviceMode === "CONTROL" && hasMaster && !isDesignatedStation/.test(hk));
const api = rd("app/api/schedules/[id]/route.ts");
const st = rd("lib/store.ts");
assert("X5 the server: PATCH takes `skipDates` (validated), the store rewrites only the skip tags inside the existing tags column and reads them back as `skipDates` — no migration", /normalizeSkipDates\(/.test(api) && /tagsWithSkipDates\(cur\.taxonomyTags/.test(st) && /skipDates: skipDatesOrUndefined\(row\.taxonomyTags\)/.test(st) && !/skip/i.test(rd("prisma/schema.prisma").split("model Schedule")[1]!.split("model ")[0]!));

console.log(`\n${pass} passed, ${fail} failed`);
