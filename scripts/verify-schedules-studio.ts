/**
 * Schedules Studio (owner 2026-11-10: "design the scheduling screen the way you think is best"): the pure timeline logic — what plays when, per day.
 * The studio only DRAWS the blocks the existing engine already uses (latest start wins, a block runs until the next start); nothing here fires playback.
 * Run: npx tsx scripts/verify-schedules-studio.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { appliesOnDay, buildDayScenes, daysKind, formatMinutes, paletteIndex, BLUE_SHADES, PALETTE_SIZE, addDays, dateKey, pastedScheduleBody, minutesToTimeLocal, nowAndNext, parseTypedTime, snapMinutes, weekDatesFor, DAY_MINUTES } from "../lib/schedules-timeline";
import { pickWinningScheduleForNow } from "../lib/schedule-window";
import type { Schedule } from "../lib/types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

const mk = (id: string, start: string, days: number[], extra: Partial<Schedule> = {}): Schedule => ({
  id, accountId: "a", name: id, branchId: "default", targetType: "PLAYLIST", targetId: "pl-" + id, daysOfWeek: days, startTimeLocal: start, endTimeLocal: "23:59", enabled: true, priority: 1, ...extra,
});
// 2026-11-10 is a Tuesday → the week is Sun 2026-11-08 … Sat 2026-11-14
const week = weekDatesFor(new Date(2026, 10, 10, 15, 0));
assert("S1 the week dates run Sunday → Saturday around a Tuesday", week[0] === "2026-11-08" && week[2] === "2026-11-10" && week[6] === "2026-11-14", JSON.stringify(week));

const items = [mk("morning", "08:00:00", [1, 2, 3, 4, 5]), mk("lunch", "12:00:00", [1, 2, 3, 4, 5]), mk("friday", "14:00:00", [5]), mk("evening", "17:00:00", [1, 2, 3, 4, 5]), mk("weekend", "09:00:00", [0, 6]), mk("night", "21:00:00", [0, 1, 2, 3, 4, 5, 6])];
const tue = buildDayScenes(items, 2, week);
assert("S2 a Tuesday has morning, lunch, evening, night — in order; every scene ends where the next one starts, the last one at midnight", tue.map((s) => s.schedule.id).join() === "morning,lunch,evening,night" && tue[0]!.end === tue[1]!.start && tue[1]!.end === tue[2]!.start && tue[2]!.end === tue[3]!.start && tue[3]!.end === DAY_MINUTES);
const fri = buildDayScenes(items, 5, week);
assert("S3 the Friday-only block cuts the lunch scene at 14:00 (and the other weekdays are untouched)", fri.map((s) => s.schedule.id).join() === "morning,lunch,friday,evening,night" && fri[1]!.end === 14 * 60 && tue[1]!.end === 17 * 60);
assert("S4 a Sunday has the weekend block and the night block only", buildDayScenes(items, 0, week).map((s) => s.schedule.id).join() === "weekend,night");

// the drawing agrees with the engine: at any minute the scene shown is the block pickWinningScheduleForNow would choose
let agree = true;
for (const day of [0, 2, 5, 6]) {
  const scenes = buildDayScenes(items, day, week);
  for (let m = 0; m < DAY_MINUTES; m += 7) {
    const d = new Date(2026, 10, 8 + day, Math.floor(m / 60), m % 60);
    const win = pickWinningScheduleForNow(items, d);
    const shown = nowAndNext(scenes, m).now?.schedule.id ?? null;
    if ((win?.id ?? null) !== shown) { agree = false; console.log("  mismatch", day, m, win?.id, shown); break; }
  }
}
assert("S5 the scene drawn at every minute is the block the engine would pick (latest start wins)", agree);

const withPaused = [...items, mk("off", "10:00:00", [2], { enabled: false })];
const tue2 = buildDayScenes(withPaused, 2, week);
assert("S6 a paused (disabled) block is shown as a marker and does not cut the music that plays through it", tue2.find((s) => s.schedule.id === "off")?.paused === true && tue2.find((s) => s.schedule.id === "morning")!.end === 12 * 60);
const dup = buildDayScenes([mk("a", "08:00:00", [2]), mk("b", "08:00:00", [2], { priority: 5 })], 2, week);
assert("S7 two blocks with the same start: the better priority plays, the other is marked shadowed", dup.find((s) => s.schedule.id === "a")!.shadowed === false && dup.find((s) => s.schedule.id === "b")!.shadowed === true);
const one = mk("once", "10:00:00", [], { recurrence: "one_off", oneOffDateLocal: "2026-11-12" });
assert("S8 a one-time block appears only on its own date's weekday (Thursday 12th), and not in another week", appliesOnDay(one, 4, week) && !appliesOnDay(one, 3, week) && !appliesOnDay(one, 4, weekDatesFor(new Date(2026, 10, 20))));
const nn = nowAndNext(tue, 13 * 60);
assert("S9 at 13:00 on a Tuesday: lunch plays, evening is next", nn.now?.schedule.id === "lunch" && nn.next?.schedule.id === "evening");
assert("S10 before the first block nothing plays and the first block is next; after the last one nothing is next", nowAndNext(tue, 6 * 60).now === null && nowAndNext(tue, 6 * 60).next?.schedule.id === "morning" && nowAndNext(tue, 22 * 60).next === null);
assert("S11 time helpers: format / API string / snap", formatMinutes(485) === "08:05" && minutesToTimeLocal(485) === "08:05:00" && snapMinutes(488) === 495 && snapMinutes(487) === 480 && snapMinutes(-5) === 0 && snapMinutes(99999) === 1425);
assert("S12 days phrases: every day / weekdays / weekend / custom", daysKind([0, 1, 2, 3, 4, 5, 6]) === "every" && daysKind([1, 2, 3, 4, 5]) === "weekdays" && daysKind([6, 0]) === "weekend" && daysKind([1, 3]) === "custom");
assert("S13 the base colour is one of 8 shades of blue, stable for the same playlist, and spread over several shades", paletteIndex("pl-a") === paletteIndex("pl-a") && ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].every((k) => paletteIndex("pl-" + k) >= 0 && paletteIndex("pl-" + k) < BLUE_SHADES) && new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((k) => paletteIndex("pl-" + k))).size >= 4 && BLUE_SHADES === 8 && PALETTE_SIZE === 18);
assert("S17 dates: addDays crosses a month end and a year end, dateKey pads", dateKey(addDays(new Date(2026, 10, 28), 5)) === "2026-12-03" && dateKey(addDays(new Date(2026, 11, 30), 3)) === "2027-01-02" && dateKey(new Date(2026, 0, 5)) === "2026-01-05");
const src = mk("lunch", "12:00:00", [1, 2, 3, 4, 5], { deviceId: "dev-1", branchId: "b7" });
const pb = pastedScheduleBody(src, "2026-11-20") as Record<string, unknown>;
assert("S18 a pasted block keeps the start time, music, branch and device, and is one-time on the chosen date", pb.startTimeLocal === "12:00:00" && pb.targetId === "pl-lunch" && pb.targetType === "PLAYLIST" && pb.branchId === "b7" && pb.deviceId === "dev-1" && pb.recurrence === "one_off" && pb.oneOffDateLocal === "2026-11-20" && Array.isArray(pb.daysOfWeek) && (pb.daysOfWeek as number[]).length === 0);
const pasted = { ...(pb as object), id: "p1", accountId: "a" } as unknown as Schedule;
assert("S19 …and it shows on that date's weekday of that week only (Fri 20 Nov), nowhere else", appliesOnDay(pasted, 5, weekDatesFor(new Date(2026, 10, 20))) && !appliesOnDay(pasted, 5, weekDatesFor(new Date(2026, 10, 10))) && !appliesOnDay(pasted, 4, weekDatesFor(new Date(2026, 10, 20))));

assert("S16 typed times: 7 / 07 / 730 / 0730 / 7:30 / 19.30 / 7:5 are times, 24:00 / 7:61 / abc / empty are not", parseTypedTime("7") === 420 && parseTypedTime("07") === 420 && parseTypedTime("730") === 450 && parseTypedTime("0730") === 450 && parseTypedTime("7:30") === 450 && parseTypedTime("19.30") === 1170 && parseTypedTime("7:5") === 425 && parseTypedTime("24:00") === null && parseTypedTime("7:61") === null && parseTypedTime("abc") === null && parseTypedTime("") === null);

const comp = rd("components/schedules-studio/schedules-studio.tsx");
const css = rd("app/schedules-studio.css");
assert("S20 the screen has a Day / Week switch, back / forward navigation with Today, and the day view draws one row per branch", /ss-seg--view/.test(comp) && /shiftFocus\(view === "day" \? -1 : -7\)/.test(comp) && /shiftFocus\(view === "day" \? 1 : 7\)/.test(comp) && /setFocus\(null\)/.test(comp) && /dayRows\.map\(\(row\) =>/.test(comp));
assert("S21 copy / paste: the card's Copy button and Ctrl/⌘+C copy, a click on a day's title or Ctrl/⌘+V pastes a one-time block at the same hour, with Undo", /onCopy=\{/.test(comp) && /mod && e\.key\.toLowerCase\(\) === "c"/.test(comp) && /mod && e\.key\.toLowerCase\(\) === "v"/.test(comp) && /pastedScheduleBody\(clip, ymd\)/.test(comp) && /removeNow\(created\.id\)/.test(comp));
assert("S22 colours: eight shades of blue first, then ten more colours to choose from (18 gradients by data-c); a block's colour can be chosen in the card and in the ⋯ menu and is remembered", (css.match(/--c1: #[0-9a-f]{6}; --c2: #[0-9a-f]{6};/g) ?? []).length === 18 && !/hsl\(var\(--h\)/.test(css) && /paletteIndex\(/.test(comp) && /ColorSwatches/.test(comp) && /setBlockColor\(/.test(comp) && !/appleIndexFromPixels|sampleCoverColor/.test(comp));
assert("S23 the repeat switch turns a block into a one-time block on the clicked date and back into a weekly one", /recurrence: "one_off", oneOffDateLocal: occurrenceDate, daysOfWeek: \[\]/.test(comp) && /recurrence: "weekly", daysOfWeek: \[weekdayOfDate\(/.test(comp));

assert("S26 a block shows its name first and the time UNDER it; the pointer on a block reveals a ⋯ button that opens a menu (edit, play now, copy, 15 min earlier / later, pause, delete) — also on right-click", comp.indexOf('className="ss-b-name"') < comp.indexOf('className="ss-b-time"') && /className="ss-b-more"/.test(comp) && /onContextMenu=\{/.test(comp) && /<BlockMenu/.test(comp) && /onNudge\(-15\)/.test(comp) && /onNudge\(15\)/.test(comp) && /\.ss-block:hover \.ss-b-more/.test(css) && /\.ss-menu-item:hover/.test(css));

assert("S27 a block shared by several days moves ONLY on the day under the pointer: a virtual copy is drawn while dragging, and on drop that day is detached into its own weekly block (with Undo); a one-day or one-time block is simply moved", /isMultiDayWeekly\(src\)/.test(comp) && /id: `\$\{src\.id\}#drag`, daysOfWeek: \[drag\.day\]/.test(comp) && /moveOccurrence\(items\.find/.test(comp) && /\{ daysOfWeek: rest \}/.test(comp) && /await removeNow\(created\.id\)|void removeNow\(created\.id\)\.then/.test(comp));
assert("S28 the ⋯ menu acts on the block under the pointer: 15 minutes earlier / later move that day only, 'Remove from {day}' appears for a multi-day block, and its Delete then says it deletes all days", /onNudge=\{\(delta\) =>[^}]*moveOccurrence\(sc, d,/.test(comp) && /onRemoveDay=\{/.test(comp) && /tr\("Delete all days"\)/.test(comp));
assert("S29 only the block you stand on lifts (hover) and shows the dots; selected / menu / copied markers are per day, not for every repeat of the block", /\.ss-block:hover \{ transform: translateY\(-2px\) scale\(1\.012\)/.test(css) && /editor\?\.day === sc\.day/.test(comp) && /menu\.day === sc\.day/.test(comp) && /clipDay === sc\.day/.test(comp));

// ── wiring (static) — filled in as the screen is built ──
const page = rd("app/(app)/(workspace)/schedules/page.tsx");
assert("S14 the Schedules page renders the studio and keeps its data loading", /<SchedulesStudio/.test(page) && /authFetch\("\/api\/schedules"\)/.test(page));
const pc = rd("components/player-auto-compact.tsx");
assert("S15 on /schedules the player stays folded into the slim bar (attribute logic only; the playback chain is untouched)", /LOCKED_COMPACT = \/\^\\\/schedules/.test(pc) && /if \(locked\)/.test(pc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
