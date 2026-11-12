/**
 * Schedules Studio (owner 2026-11-10: "design the scheduling screen the way you think is best"): the pure timeline logic — what plays when, per day.
 * The studio only DRAWS the blocks the existing engine already uses (latest start wins, a block runs until the next start); nothing here fires playback.
 * Run: npx tsx scripts/verify-schedules-studio.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_BIZ_HOURS, bizDay, closingPlan, parseBizHours, viewRange, DEFAULT_DISPLAY, familyShade, formatLength, parseDisplay, toneFromPixels, jingleMinutesOn, jinglesOnDay, appliesOnDay, buildDayScenes, daysKind, formatMinutes, paletteIndex, BLUE_SHADES, PALETTE_SIZE, addDays, dateKey, pastedScheduleBody, minutesToTimeLocal, nowAndNext, parseTypedTime, snapMinutes, weekDatesFor, DAY_MINUTES, zoomWindow, panWindow, tickStep, windowTicks, scaleBar, MIN_WINDOW_MINUTES } from "../lib/schedules-timeline";
import { pickWinningScheduleForNow } from "../lib/schedule-window";
import { playingBlockAt } from "../lib/schedule-actions";
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

assert("S26 a block shows its name first and the time UNDER it; there are NO three dots on a block or on a day-list row (the card holds everything); the menu (edit, play now, copy, 15 min earlier / later, pause, delete) stays on right-click", comp.indexOf('className="ss-b-name"') < comp.indexOf('className="ss-b-time"') && !/ss-b-more|ss-ag-more/.test(comp) && !/ss-b-more|ss-ag-more/.test(css) && /onContextMenu=\{/.test(comp) && /<BlockMenu/.test(comp) && /onNudge\(-15\)/.test(comp) && /onNudge\(15\)/.test(comp) && /\.ss-menu-item:hover/.test(css));

assert("S27 a block shared by several days moves ONLY on the day under the pointer: a virtual copy is drawn while dragging, and on drop that day is detached into its own weekly block (with Undo); a one-day or one-time block is simply moved", /isMultiDayWeekly\(src\)/.test(comp) && /id: `\$\{src\.id\}#drag`, daysOfWeek: \[drag\.day\]/.test(comp) && /editOccurrence\(items\.find/.test(comp) && /\{ daysOfWeek: rest \}/.test(comp) && /await removeNow\(created\.id\)|void removeNow\(created\.id\)\.then/.test(comp));
assert("S28 the ⋯ menu acts on the block under the pointer: 15 minutes earlier / later move that day only, 'Remove from {day}' appears for a multi-day block, and its Delete then says it deletes all days", /onNudge=\{\(delta\) =>[^}]*editOccurrence\(sc, d,/.test(comp) && /onRemoveDay=\{/.test(comp) && /tr\("Delete all days"\)/.test(comp));
assert("S29 only the block you stand on lifts (hover) and shows the dots; selected / menu / copied markers are per day, not for every repeat of the block", /\.ss-block:hover \{ transform: translateY\(-2px\) scale\(1\.012\)/.test(css) && /editor\?\.day === sc\.day/.test(comp) && /menu\.day === sc\.day/.test(comp) && /clipDay === sc\.day/.test(comp));

// ── explicit ends and quiet blocks (owner 2026-11-11) ──
const endDay = [mk("a", "08:00:00", [2], { endTimeLocal: "10:30:00" }), mk("b", "12:00:00", [2], { endTimeLocal: "23:59" }), mk("q", "15:00:00", [2], { targetType: "SILENCE", targetId: "silence", name: "Quiet" }), mk("c", "16:00:00", [2], { endTimeLocal: "20:00:00" })];
const ed = buildDayScenes(endDay, 2, week);
const edBy = (id: string) => ed.find((x) => x.schedule.id === id)!;
assert("S30 a block with an END is drawn only until that end (a gap follows when nothing else starts), a block without one runs to the next start", edBy("a").end === 10 * 60 + 30 && edBy("a").endSet === true && edBy("b").end === 15 * 60 && edBy("b").endSet === false && edBy("c").end === 20 * 60 && edBy("c").endSet === true);
assert("S31 a QUIET block is a scene marked quiet that lasts until the next block (its own end is ignored); a block's end that is later than the next start does not stretch it", edBy("q").quiet === true && edBy("q").end === 16 * 60 && edBy("q").endSet === false && buildDayScenes([mk("x", "08:00:00", [2], { endTimeLocal: "18:00:00" }), mk("y", "09:00:00", [2])], 2, week)[0]!.end === 9 * 60);
let sameAsEngine = true;
for (let m = 0; m < DAY_MINUTES; m += 5) {
  const d = new Date(2026, 10, 10, Math.floor(m / 60), m % 60);
  const engine = playingBlockAt(endDay, d)?.id ?? null;
  const shownNow = nowAndNext(ed, m).now;
  const drawn = shownNow && !shownNow.quiet ? shownNow.schedule.id : null;
  if (engine !== drawn) { sameAsEngine = false; console.log("  mismatch at", formatMinutes(m), engine, drawn); break; }
}
assert("S32 across a whole simulated day, what the timeline draws as playing is exactly what the engine decides is playing (ends, quiet blocks, gaps)", sameAsEngine);
assert("S33 a pasted copy keeps the block's end", pastedScheduleBody(endDay[0]!, "2026-11-12").endTimeLocal === "10:30:00" && !("endTimeLocal" in pastedScheduleBody(mk("z", "09:00:00", [2], { endTimeLocal: "" }), "2026-11-12")));

// ── jingles on the schedule (owner 2026-11-12): small markers on the timeline, the Jingles screen keeps the data ──
const wk = { id: "j1", label: "Opening", repeat: "weekdays" as const, days: [1, 2, 3, 4, 5], timeOfDay: "08:30" };
const dly = { id: "j2", label: "Hourly", repeat: "daily" as const, scheduledAtIso: new Date(2026, 10, 9, 13, 5).toISOString() };
const wkl = { id: "j3", label: "Sale", repeat: "weekly" as const, scheduledAtIso: new Date(2026, 10, 10, 16, 20).toISOString() }; // a Tuesday
const once = { id: "j4", label: "Once", repeat: "once" as const, scheduledAtIso: new Date(2026, 10, 12, 18, 45).toISOString() };
const dd = (day: number, hh = 12) => new Date(2026, 10, 8 + day, hh, 0); // 2026-11-08 is a Sunday
assert("S38 a weekday jingle fires on its days at its time (not on a Sunday)", jingleMinutesOn(wk, dd(2)) === 8 * 60 + 30 && jingleMinutesOn(wk, dd(0)) === null && jingleMinutesOn({ ...wk, days: [] }, dd(0)) === 8 * 60 + 30 && jingleMinutesOn({ ...wk, timeOfDay: "x" }, dd(2)) === null);
assert("S39 a daily jingle fires every day from its first day on (never before it), a weekly one only on that weekday, a one-time one only on its date", jingleMinutesOn(dly, dd(3)) === 13 * 60 + 5 && jingleMinutesOn(dly, dd(0)) === null && jingleMinutesOn(wkl, dd(2)) === 16 * 60 + 20 && jingleMinutesOn(wkl, dd(3)) === null && jingleMinutesOn(wkl, dd(9)) === 16 * 60 + 20 && jingleMinutesOn(once, dd(4)) === 18 * 60 + 45 && jingleMinutesOn(once, dd(5)) === null && jingleMinutesOn({ id: "z", label: "z", repeat: "once" }, dd(4)) === null);
assert("S40 the jingles of one day come back in time order", jinglesOnDay([wkl, once, dly, wk], dd(2)).map((x) => x.item.id).join() === "j1,j2,j3");

// ── block look settings (owner 2026-11-12) ──
assert("S42 the default look is: fog blocks (the picture melting into black / white, the details below), shades of blue for music without a picture, the hours shown, the length not shown", JSON.stringify(DEFAULT_DISPLAY) === JSON.stringify({ style: "fog", weekLayout: "rows", hours: "active", colour: "palette", family: "blue", content: "both", pos: "top", times: true, length: false }));
assert("S43 a stored setting is read field by field — an unknown or broken value falls back to the default, a valid one is kept", JSON.stringify(parseDisplay(null)) === JSON.stringify(DEFAULT_DISPLAY) && parseDisplay({ pos: "bottom", times: false, content: "image", colour: "cover", family: "rose", length: true, style: "solid" }).pos === "bottom" && parseDisplay({ style: "solid" }).style === "solid" && parseDisplay({ style: "glass" }).style === "fog" && parseDisplay({ weekLayout: "columns" }).weekLayout === "columns" && parseDisplay({ weekLayout: "grid" }).weekLayout === "rows" && parseDisplay({ hours: "day" }).hours === "day" && parseDisplay({ hours: "x" }).hours === "active" && parseDisplay({ pos: "sideways", times: "yes", family: "pink" }).pos === "top" && parseDisplay({ pos: "sideways", times: "yes", family: "pink" }).times === true && parseDisplay({ pos: "sideways", family: "pink" }).family === "blue");
assert("S44 a length is shown like a player's total time (3:45, 32:10, 1:05:00)", formatLength(225) === "3:45" && formatLength(1930) === "32:10" && formatLength(3900) === "1:05:00" && formatLength(0) === "0:00");
const shades = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => familyShade("violet", i)!);
assert("S45 a colour family gives eight different light → deep shades (blue is the CSS palette itself)", familyShade("blue", 2) === null && shades.every((t) => /^#[0-9a-f]{6}$/.test(t.c1) && /^#[0-9a-f]{6}$/.test(t.c2)) && new Set(shades.map((t) => t.c1)).size === 8 && familyShade("teal", 99) !== null);
const solid = (r: number, g: number, b: number, n = 64) => Array.from({ length: n }, () => [r, g, b, 255]).flat();
const redTone = toneFromPixels(solid(220, 40, 30))!;
const grey = toneFromPixels(solid(120, 120, 120))!;
const hueOf = (hex: string) => { const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d === 0) return -1; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
assert("S46 the colour of a picture follows its dominant vivid hue, a grey picture gives a calm grey, nothing gives nothing", (hueOf(redTone.c1) < 15 || hueOf(redTone.c1) > 345) && Math.abs(parseInt(grey.c1.slice(1, 3), 16) - parseInt(grey.c1.slice(5, 7), 16)) < 30 && toneFromPixels([]) === null && toneFromPixels([0, 0, 0, 0]) === null);

// ── wiring (static) — filled in as the screen is built ──
const page = rd("app/(app)/(workspace)/schedules/page.tsx");
assert("S14 the Schedules page renders the studio and keeps its data loading", /<SchedulesStudio/.test(page) && /authFetch\("\/api\/schedules"\)/.test(page));
const pc = rd("components/player-auto-compact.tsx");
assert("S15 on /schedules the player stays folded into the slim bar (attribute logic only; the playback chain is untouched)", /LOCKED_COMPACT = \/\^\\\/schedules/.test(pc) && /if \(locked\)/.test(pc));

assert("S34 a block's END can be set three ways: a card field (Until the next block / At a time, −15 / +15), dragging its far edge (snapped to 5 min, or to the minute when zoomed in; it cuts, and 'until the next block' is the card's choice), and it keeps its length when the block moves", /tr\("Ends at"\)/.test(comp) && /className="ss-b-resize"/.test(comp) && /onTrimPointerDown\(e, sc, orient, "end"\)/.test(comp) && /snapMinutes\(from \+ d \/ perMin, dragStep\)/.test(comp) && /cut >= from \? null/.test(comp) && /oldEnd \+ \(newStart - oldStart\)/.test(comp) && /endMin \+ \(m - startMin\)/.test(comp));
assert("S35 quiet blocks: 'Quiet — no music' is the first row of the music list and of the picker, a quiet block is created in the branch row / filter it was added in, its card has no colour / device / end and says 'Stop now', its ⋯ menu says 'Stop now' too", /kind: "quiet"/.test(comp) && /\[quietItem, \.\.\./.test(comp) && /quiet=\{quietItem\}/.test(comp) && /branchId \?\? quietBranch/.test(comp) && /quiet \? null : \(\s*<div className="ss-field">\s*<span className="ss-label">\{tr\("Ends at"\)/.test(comp) && /\(stopScheduled \?\? stop\)\(\)/.test(comp) && /quiet \? tr\("Stop now"\)/.test(comp));
assert("S36 Business hours: a clock (hour / minute wheels) sets when the business opens and closes — one pair for every day, or each day on its own (a closed day, round the clock); saving keeps the closing as weekly quiet blocks named Closing (one per distinct time), created BEFORE the old ones are removed", /function BusinessHoursDialog/.test(comp) && /function Wheel/.test(comp) && /const saveClosing = useCallback/.test(comp) && /name: CLOSING_NAME, branchId, targetType: "SILENCE"/.test(comp) && comp.indexOf("for (const g of toCreate)") < comp.indexOf("if (!(await removeNow(e.id))) return false;") && /closingPlan\(next\)/.test(comp) && /onClick=\{\(\) => setHoursOpen\(true\)\}/.test(comp));
assert("S37 the new look exists in CSS: hatched quiet blocks, the end handle (vertical + horizontal), the Day hours dialog; the dialog shares the studio's colour variables", /\.ss-block\.is-quiet \{/.test(css) && /\.ss-block--v > \.ss-b-resize/.test(css) && /\.ss-block--h > \.ss-b-resize/.test(css) && /\.ss-modal \{/.test(css) && /\.ss, \.ss-pop, \.ss-menu, \.ss-modal-back \{/.test(css));

assert("S41 jingles on the schedule are display-only: a small bell at the jingle's time (never a block) from the Jingles screen's own per-branch list, a toolbar bell that hides / shows them (remembered; absent when there are none), a small card (name, time, repeat) with 'Open in Jingles' → the Jingles screen's Schedule tab; the studio never writes the jingle list", /loadJingleSchedule\(stationBranch\)/.test(comp) && !/persistJingleSchedule/.test(comp) && /className=\{`ss-jpin ss-jpin--\$\{orient\}/.test(comp) && /jingles\.length > 0 \? \(\s*<button type="button" className=\{`ss-iconbtn ss-iconbtn--sm ss-jtoggle/.test(comp) && /setJinglesOpenTab\("schedule"\);\s*router\.push\("\/jingles"\)/.test(comp) && /\.ss-jpin--v \{ inset-inline-start: -6px/.test(css));

assert("S47 the studio sits straight on the page background (no panel with square corners behind it, less margin), has no 'Now / Next' line under the title, and a fog block without a usable picture shows black / white stripes (no colour); colour choices exist only for solid blocks", /html\[data-sb-studio\] \.library-theme\.library-page-shell \{ background: none; \}/.test(css) && !/ss-status/.test(comp) && !/ss-status/.test(css) && /\.ss-b-art--tone \{ background: repeating-linear-gradient\(135deg, #121215/.test(css) && /display\.style === "solid" \? seg\(tr\("Colours"\)/.test(comp));
assert("S48 a picture that cannot be used (it failed, or is only a tiny placeholder like a removed video's grey thumbnail) is replaced, and a YouTube thumbnail is shown in its true 16:9 shape (no black bars)", /naturalWidth < 200/.test(comp) && /markBadArt/.test(comp) && /mqdefault\.jpg/.test(comp));
assert("S49 the Day view has no row of day chips: the day itself is the picker (week days on rest, a calendar on request)", !/ss-daychip/.test(comp) && /className=\{`ss-range ss-daypick/.test(comp) && /function DayPicker/.test(comp) && /Pick a date/.test(comp));

assert("S50 a block has a strip on each edge (cut from the start / from the end) and the middle moves it (no hand icon); it can be cut shorter and stretched back but never beyond the music's own length when that is known (the drag and the card's stepper both stop at it)", /ss-b-resize ss-b-resize--start/.test(comp) && !/ss-b-hand|HandIcon/.test(comp) && !/ss-b-hand/.test(css) && /maxLenOf/.test(comp) && /Math\.min\(Math\.max\(begin \+ 5, m\), begin \+ maxLen, END_MAX\)/.test(comp) && /Math\.min\(END_MAX, startMin \+ maxLen, Math\.max\(startMin \+ 5, m\)\)/.test(comp) && /editOccurrence\(base, sc\.day, \{ start: last, end: ownEnd \?\? \(musicEnd < naturalEnd \? musicEnd : null\) \}\)/.test(comp));
assert("S51 the week can be drawn as seven wide rows (days down, hours across — the pictures keep their shape) or as the classic tall columns; the layout is a Display setting, rows by default", /display\.weekLayout === "rows"/.test(comp) && /ss-hrows--week/.test(comp) && /\{ v: "rows", t: tr\("Rows"\) \}/.test(comp) && /\.ss-hrows--week \.ss-hrow/.test(css));

// ── business hours and the hours the timeline shows ──
const everyDay = { ...DEFAULT_BIZ_HOURS, all: { open: 8 * 60, close: 22 * 60 } };
assert("S52 'same hours every day' closes the music at 22:00 on every calendar day; round the clock has no closing; a closed day is quiet from midnight; an evening that ends the next morning puts its closing on the next day", closingPlan(everyDay).every((m) => m === 22 * 60) && closingPlan({ ...everyDay, h24: true }).every((m) => m === null) && closingPlan({ ...everyDay, same: false, days: everyDay.days.map((h, d) => (d === 6 ? null : h)) })[6] === 0 && closingPlan({ ...everyDay, all: { open: 14 * 60, close: 5 * 60 } }).every((m) => m === 5 * 60));
assert("S53 the timeline shows the business's own hours (plus the hour of the closing marker), the whole day when asked, round the clock or overnight; with no hours set it fits the schedule; it is never thinner than eight hours and never hides a block that starts", JSON.stringify(viewRange("active", everyDay, [])) === JSON.stringify({ first: 8, last: 23 }) && JSON.stringify(viewRange("day", everyDay, [])) === JSON.stringify({ first: 0, last: 24 }) && viewRange("active", { ...everyDay, all: { open: 14 * 60, close: 5 * 60 } }, []).last === 24 && viewRange("active", { ...everyDay, h24: true }, []).first === 0 && JSON.stringify(viewRange("active", null, [9 * 60, 17 * 60])) === JSON.stringify({ first: 8, last: 19 }) && viewRange("active", null, [10 * 60]).last - viewRange("active", null, [10 * 60]).first >= 8 && viewRange("active", everyDay, [6 * 60]).first === 6 && JSON.stringify(viewRange("active", null, [])) === JSON.stringify({ first: 8, last: 22 }));
assert("S54 stored hours are read safely (nothing stored → null; a closed day stays closed; broken numbers fall back)", parseBizHours(null) === null && parseBizHours({ same: false, days: [null, { open: 600, close: 1200 }], all: { open: 480, close: 1320 } })!.days[0] === null && parseBizHours({ same: false, days: [null, { open: 600, close: 1200 }], all: { open: 480, close: 1320 } })!.days[1]!.close === 1200 && parseBizHours({ all: { open: "x", close: 5 } })!.all.open === 480 && bizDay(everyDay, 3)!.open === 480);

assert("S55 the hours shown follow the business (Display → Hours shown: Active hours / Full day; nothing scheduled is hidden); a click on empty ground that only closes a card opens nothing; a dropped song opens no card; a second click on the block whose card is open closes it", /const range = useMemo\(/.test(comp) && /viewRange\(display\.hours, biz,/.test(comp) && /\{ v: "active", t: tr\("Active hours"\) \}/.test(comp) && !/const FIRST_H = 5/.test(comp) && /if \(justClosedPopup\(\)\) return;/.test(comp) && /await create\(item, day, m, branchId\);/.test(comp) && /const wasOpen = editor\?\.kind === "edit" && editor\.id === sc\.schedule\.id && editor\.day === sc\.day;/.test(comp) && /if \(wasOpen\) \{\s*setEditor\(null\);/.test(comp));
assert("S56 a dropped song / playlist is exactly as long as its music (its end is stored: start + own length, +20 s rounded up to the minute) and stays 'until the next block' only when the length is unknown or runs past the day; the cap and the drop share one helper; trimming the start of an 'until the next block' playlist measures from where the music really ends, never from the far end of the day", /function fitMinutes\(/.test(comp) && /const maxLenOf = \(s: Schedule\): number => fitMinutes\(libFor\(s\)\?\.dur\);/.test(comp) && /min \+ fitMinutes\(item\.dur\) <= END_MAX \? \{ endTimeLocal: minutesToTimeLocal\(min \+ fitMinutes\(item\.dur\)\) \}/.test(comp) && /const musicEnd = Number\.isFinite\(maxLen\) \? Math\.min\(naturalEnd, begin \+ maxLen\) : naturalEnd;/.test(comp) && /const endNow = ownEnd \?\? musicEnd;/.test(comp) && !/const endNow = ownEnd \?\? naturalEnd;/.test(comp));
assert("S57 when the music's length is NOT known the edge strips only cut: the end never goes past where the block ends now, the start never earlier than it starts now (nothing is taken hours away)", /const cut = Math\.min\(m, from\);/.test(comp) && /last = ownEnd === null && cut >= from \? null : Math\.max\(begin \+ 5, cut\);/.test(comp) && /: begin; \/\/ unknown length: only cut/.test(comp));

assert("S58 the click a drag ends with (a trim or a move released over empty ground) opens no 'Add music' card", (comp.match(/markPopupClose\(\); \/\/ the click a drag ends with/g) ?? []).length === 1 && /markPopupClose\(\); \/\/ \(same: the click that ends a drag opens nothing\)/.test(comp));

assert("S59 the two trim strips show only while the pointer is on the block or it is dragged (not at rest, not for a block with an end, not for the block whose card is open); while a strip or the block is dragged the cursor stays a resize / grabbing cursor wherever it goes — never the '+' of the empty track", !/\.ss-block\.has-end > \.ss-b-resize/.test(css) && !/\.ss-block\.is-selected > \.ss-b-resize/.test(css) && /\.ss-block:hover > \.ss-b-resize::after, \.ss-block\.is-dragging > \.ss-b-resize::after \{ opacity: 0\.85; \}/.test(css) && /html\.sb-ss-cursor-ew-resize, html\.sb-ss-cursor-ew-resize \* \{ cursor: ew-resize !important; \}/.test(css) && /function holdCursor\(/.test(comp) && /holdCursor\(orient === "v" \? "ns-resize" : "ew-resize"\)/.test(comp) && /holdCursor\("grabbing"\)/.test(comp) && /releaseCursor\(\);\n      setDrag\(null\);/.test(comp));

assert("S60 moving a block never slides it off the hours shown and a block that has an end keeps its length at the edge (the drag and the saved move both stop where the end would hit the end of the day; the 15-minute nudges and the card's start time too) — only the strips change the length", /const keep = own !== null \? own - startMin : 5;/.test(comp) && /Math\.min\(LAST_H \* 60, own !== null \? END_MAX : DAY_MINUTES\) - keep/.test(comp) && /if \(edit\.end === undefined && oldEnd !== null\) newStart = Math\.min\(newStart, Math\.max\(oldStart, END_MAX - \(oldEnd - oldStart\)\)\);/.test(comp) && /const m = endMin !== null \? Math\.min\(want, Math\.max\(startMin, END_MAX - \(endMin - startMin\)\)\) : want;/.test(comp));

assert("S61 a live radio station has no length of its own: both strips stretch it to any length (up to the end of the day) — the cut-only rule is for songs of unknown length; a strip is never wider than a quarter of a short block, so the middle can still be grabbed to move it", /const live = sc\.schedule\.targetType === "RADIO";/.test(comp) && /else if \(live\) last = m >= END_MAX \? null : Math\.max\(begin \+ 5, m\);/.test(comp) && /: live \? FIRST_H \* 60 : begin;/.test(comp) && /height: min\(11px, 26%\)/.test(css) && /width: min\(11px, 26%\)/.test(css));

{
  const w0 = { a: 420, b: 1320 }; // 07:00 – 22:00
  const z = zoomWindow(w0, 0.5, 0.5);
  const zl = zoomWindow(w0, 0.5, 0); // anchored on the left edge: the left edge stays put
  const zr = zoomWindow(w0, 0.5, 1); // on the right edge: the right edge stays put
  const out = zoomWindow(w0, 100, 0.5); // zooming out never leaves the day
  const near = zoomWindow({ a: 600, b: 640 }, 0.01, 0.5); // zooming in stops at the closest allowed
  const p1 = panWindow({ a: 100, b: 400 }, -500), p2 = panWindow({ a: 1200, b: 1400 }, 500);
  assert("S62 zooming a window keeps the minute under the pointer where it was, never leaves the day, never closer than the limit; panning slides it and stops at the day's ends",
    Math.abs((z.b - z.a) - 450) < 1e-9 && Math.abs((z.a + z.b) / 2 - (w0.a + w0.b) / 2) < 1e-9 && Math.abs(zl.a - w0.a) < 1e-9 && Math.abs(zr.b - w0.b) < 1e-9
    && out.a === 0 && out.b === DAY_MINUTES && Math.abs((near.b - near.a) - MIN_WINDOW_MINUTES) < 1e-9
    && p1.a === 0 && p1.b === 300 && p2.b === DAY_MINUTES && p2.b - p2.a === 200, JSON.stringify({ z, zl, zr, out, near, p1, p2 }));
  assert("S63 the hour labels follow the zoom: whole hours at a wide view, every 15 / 5 minutes when zoomed in, never closer than the room allows; the scale bar is the longest nice length that fits",
    tickStep(1.2) === 60 && tickStep(0.7) === 120 && tickStep(8) === 10 && tickStep(40) === 2 && tickStep(100) === 1
    && windowTicks({ a: 420, b: 1320 }, 60).join() === "420,480,540,600,660,720,780,840,900,960,1020,1080,1140,1200,1260"
    && windowTicks({ a: 485, b: 530 }, 15).join() === "495,510,525"
    && scaleBar(1.2).minutes === 60 && scaleBar(8).minutes === 10 && scaleBar(8).px === 80 && scaleBar(0.05).minutes === 720 && scaleBar(500).minutes === 1);
}
assert("S64 the hours can be zoomed and slid (wheel / pinch around the pointer, − / + buttons, drag the ruler, double click or the scale to go back); the hour labels and the scale bar follow the zoom; labels blur in and out; blocks glide while it zooms; the vertical week view is untouched",
  /function HoursRuler\(/.test(comp) && /function ZoomControl\(/.test(comp) && /addEventListener\("wheel", onWheel, \{ passive: false \}\)/.test(comp) && /zoomWindow\(w, factor, ratio\)/.test(comp) && /panWindow\(w,/.test(comp)
  && /const onRulerPointerDown/.test(comp) && /onDoubleClick=\{onReset\}/.test(comp) && /const pct = \(min: number\) => \(\(Math\.min\(Math\.max\(min, winA\), winB\) - winA\) \/ SPAN\) \* 100;/.test(comp)
  && /orient === "h" && \(sc\.end <= winA \|\| sc\.start >= winB\)/.test(comp) && /\.ss-htick\.is-leaving \{ animation: ss-tick-out/.test(css) && /@keyframes ss-tick-in/.test(css) && /\.ss-dayview\.is-zoom-smooth \.ss-block--h/.test(css)
  && /const topOf = \(min: number\) => \(\(Math\.max\(min, FIRST_H \* 60\) - FIRST_H \* 60\) \* HOUR_H\) \/ 60;/.test(comp));

assert("S65 snapping follows the zoom: blocks move and trim in whole 5 minutes normally and in single minutes once a minute is wide enough to aim at; a new block lands on 15 → 5 → 1 minutes", /const dragStep = pxPerMinNow >= 14 \? 1 : 5;/.test(comp) && /const placeStep = pxPerMinNow >= 14 \? 1 : pxPerMinNow >= 4 \? 5 : 15;/.test(comp) && /snapMinutes\(startMin \+ d \/ perMin, dragStep\)/.test(comp) && /snapMinutes\(from \+ d \/ perMin, dragStep\)/.test(comp) && /snapMinutes\(winA \+ ratio \* SPAN, placeStep\)/.test(comp));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
