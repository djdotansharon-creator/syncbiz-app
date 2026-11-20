/**
 * THE PHONE'S SCHEDULE (owner 2026-11-20: "I must get the song scheduling working on the phone — properly, nicely designed"):
 * the phone now makes the plan itself — add a block, change its music / time / days, switch it off for one day, remove it from one day or from all — with the Schedules Studio's own routes.
 * Behavioural tests of the pure rules (lib/mobile-schedule.ts) + static guards of the wiring (components/vm/vm-schedule.tsx, app/mobile-app.css, the phrasebook).
 * Run: npx tsx scripts/verify-mobile-schedule.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  QUIET_CHOICE,
  barSegments,
  blockColours,
  blockFields,
  canRemoveOneDay,
  clashingBlock,
  createBody,
  daysTextOf,
  daysWithout,
  fitsBranch,
  formFromSchedule,
  formProblem,
  musicOfSchedule,
  musicOfSource,
  newForm,
  rowState,
  stripDays,
  suggestStart,
  type BlockForm,
  type MusicChoice,
} from "../lib/mobile-schedule";
import { buildDayScenes, nowAndNext, weekDatesFor, type Scene } from "../lib/schedules-timeline";
import { HE_PHRASES } from "../lib/i18n/phrases";
import type { Schedule } from "../lib/types";
import type { UnifiedSource } from "../lib/source-types";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

// ── fakes ──
const sch = (id: string, o: Partial<Schedule> = {}): Schedule => ({
  id, accountId: "a", branchId: "b1", targetType: "PLAYLIST", targetId: `pl-${id}`, recurrence: "weekly", daysOfWeek: [5], startTimeLocal: "09:00:00", endTimeLocal: "23:59:00", enabled: true, priority: 1, ...o,
}) as Schedule;
const FRI = new Date(2026, 10, 20, 12, 0); // Friday 20 November 2026
const WEEK = weekDatesFor(FRI); // Sunday 15 … Saturday 21
const music = (o: Partial<MusicChoice> = {}): MusicChoice => ({ targetType: "PLAYLIST", targetId: "pl-1", title: "Morning", cover: null, ...o });
const form = (o: Partial<BlockForm> = {}): BlockForm => ({ music: music(), start: 540, endMode: "next", end: 600, repeat: "weekly", days: [5], onceDate: "2026-11-20", ...o });
const pl = (id: string, o: Record<string, unknown> = {}): UnifiedSource => ({ id, title: `List ${id}`, genre: "Mixed", cover: "c.jpg", type: "youtube", url: "", origin: "playlist", playlist: { id, name: `List ${id}`, tracks: [], ...o } }) as unknown as UnifiedSource;

// ── what a block plays ──
assert("S1 a library entry is a block's music: a playlist (by its playlist id), a single song (by its source id), a radio station — and ONE SONG INSIDE a playlist is not (its playlist is)", (() => {
  const p = musicOfSource(pl("p1"));
  const s = musicOfSource({ id: "src-9", title: "Song", genre: "Mixed", cover: null, type: "youtube", url: "", origin: "source", source: { id: "src-9" } } as unknown as UnifiedSource);
  const r = musicOfSource({ id: "radio-1", title: "Kan", genre: "Mixed", cover: null, type: "stream-url", url: "", origin: "radio" } as unknown as UnifiedSource);
  return p?.targetType === "PLAYLIST" && p.targetId === "p1" && s?.targetType === "SOURCE" && s.targetId === "src-9" && r?.targetType === "RADIO" && r.targetId === "radio-1" && musicOfSource(pl("p1:track:abc")) === null;
})());
assert("S2 the music of a stored block: quiet is quiet; found in the library it is the library's; not found it is what the block remembers (its name)", (() => {
  const q = musicOfSchedule(sch("q", { targetType: "SILENCE", targetId: "silence", name: "Closing" }), () => undefined);
  const found = musicOfSchedule(sch("a", { targetId: "p1" }), () => pl("p1"));
  const lost = musicOfSchedule(sch("b", { targetId: "gone", name: "Old list" }), () => undefined);
  return q.targetType === "SILENCE" && q.title === "Closing" && found.targetId === "p1" && found.cover === "c.jpg" && lost.targetId === "gone" && lost.title === "Old list" && lost.cover === null;
})());
assert("S3 only music that can play on THIS branch is offered: another real branch's is left out, a legacy entry with no branch (the 'default' one) stays", (() => {
  const known = new Set(["b1", "b2"]);
  const mine = pl("x", { branchId: "b1" }), other = pl("y", { branchId: "b2" }), legacy = pl("z", {});
  return fitsBranch(mine, "b1", known) && !fitsBranch(other, "b1", known) && fitsBranch(legacy, "b1", known);
})());

// ── the form ──
assert("S4 nothing is saved until it is complete: music chosen · at least one day (weekly) · a real date (one time) · an end after the start", (() => {
  return formProblem(form({ music: null })) === "music" && formProblem(form({ days: [] })) === "days" && formProblem(form({ repeat: "once", onceDate: "nope" })) === "date"
    && formProblem(form({ endMode: "at", start: 600, end: 600 })) === "end" && formProblem(form({ endMode: "at", start: 600, end: 540 })) === "end"
    && formProblem(form()) === null && formProblem(form({ endMode: "at", start: 540, end: 600 })) === null && formProblem(form({ repeat: "once", days: [] })) === null;
})());
assert("S5 a weekly block is saved with the Studio's own fields — 'until the next block' is the stored default 23:59, an end is the end", (() => {
  const a = blockFields(form({ days: [5, 1, 1] }), "Quiet");
  const b = blockFields(form({ endMode: "at", start: 540, end: 1050 }), "Quiet");
  return a.recurrence === "weekly" && JSON.stringify(a.daysOfWeek) === "[1,5]" && a.startTimeLocal === "09:00:00" && a.endTimeLocal === "23:59:00" && a.targetType === "PLAYLIST" && a.targetId === "pl-1" && a.name === "Morning" && !("oneOffDateLocal" in a) && b.endTimeLocal === "17:30:00";
})());
assert("S6 a one-time block is saved as one_off on its date with no weekdays; a quiet block carries the fixed id 'silence'; a single song also carries its sourceId", (() => {
  const o = blockFields(form({ repeat: "once", onceDate: "2026-12-01", days: [1, 2] }), "Quiet");
  const q = blockFields(form({ music: { ...QUIET_CHOICE, title: "x" } }), "Quiet");
  const s = blockFields(form({ music: music({ targetType: "SOURCE", targetId: "src-1" }) }), "Quiet");
  return o.recurrence === "one_off" && o.oneOffDateLocal === "2026-12-01" && JSON.stringify(o.daysOfWeek) === "[]" && q.targetType === "SILENCE" && q.targetId === "silence" && q.name === "Quiet" && s.sourceId === "src-1" && !("sourceId" in blockFields(form(), "Quiet"));
})());
assert("S7 a new block is made for the open branch, switched on, priority 1; nothing but ids, names, times and days goes to the server (no path, no url, no cover)", (() => {
  const body = createBody(form(), "b1", "Quiet");
  const allowed = new Set(["name", "targetType", "targetId", "sourceId", "recurrence", "daysOfWeek", "oneOffDateLocal", "startTimeLocal", "endTimeLocal", "branchId", "enabled", "priority"]);
  return body.branchId === "b1" && body.enabled === true && body.priority === 1 && Object.keys(body).every((k) => allowed.has(k)) && !/https?:|[A-Za-z]:\\|\/Users\//.test(JSON.stringify(createBody(form({ music: music({ cover: "https://x/y.jpg" }) }), "b1", "Quiet")));
})());
assert("S8 a stored block opens as the same form (an end that was set → 'at a time'; the default 23:59 → 'until the next block'; a one-time block → 'only that date')", (() => {
  const a = formFromSchedule(sch("a", { endTimeLocal: "17:00:00", daysOfWeek: [3, 1] }), music(), "2026-11-20");
  const b = formFromSchedule(sch("b"), music(), "2026-11-20");
  const c = formFromSchedule(sch("c", { recurrence: "one_off", oneOffDateLocal: "2026-12-24", daysOfWeek: [] }), music(), "2026-11-20");
  return a.endMode === "at" && a.end === 1020 && JSON.stringify(a.days) === "[1,3]" && a.start === 540 && b.endMode === "next" && c.repeat === "once" && c.onceDate === "2026-12-24";
})());
assert("S9 a new block starts at a sensible time: today → the next quarter of an hour; another day → where the last block ends, else 09:00; and it opens on the day shown", (() => {
  const noScenes: Scene[] = [];
  const day = buildDayScenes([sch("a", { startTimeLocal: "10:00:00", endTimeLocal: "12:00:00" })], 5, WEEK);
  const f = newForm({ dateYmd: "2026-11-20", dow: 5, start: 600 });
  return suggestStart({ isToday: true, nowMin: 12 * 60 + 41, scenes: noScenes }) === 13 * 60 && suggestStart({ isToday: false, nowMin: 0, scenes: noScenes }) === 540 && suggestStart({ isToday: false, nowMin: 0, scenes: day }) === 720 && JSON.stringify(f.days) === "[5]" && f.music === null && f.repeat === "weekly";
})());

// ── removing ──
assert("S10 one weekday can be taken off a weekly block that plays on more than that day; a single-day, one-time or other-day case removes the block itself", (() => {
  const multi = sch("m", { daysOfWeek: [1, 3, 5] });
  return canRemoveOneDay(multi, 3) && JSON.stringify(daysWithout(multi, 3)) === "[1,5]" && !canRemoveOneDay(sch("one", { daysOfWeek: [5] }), 5) && !canRemoveOneDay(sch("o", { recurrence: "one_off", daysOfWeek: [] }), 5) && !canRemoveOneDay(multi, 2);
})());

// ── two blocks on the same minute ──
assert("S11 the phone never makes two blocks that start on the same minute of the same day (the engine would drop one by a coin toss): it names the block already there — not another minute, another day, a switched-off block, or the block itself", (() => {
  const list = [sch("a", { startTimeLocal: "09:00:00", daysOfWeek: [5] })];
  const same = clashingBlock(form({ start: 540, days: [5] }), list, null, WEEK);
  return same?.id === "a" && clashingBlock(form({ start: 541, days: [5] }), list, null, WEEK) === null && clashingBlock(form({ start: 540, days: [4] }), list, null, WEEK) === null
    && clashingBlock(form({ start: 540, days: [5] }), [sch("a", { startTimeLocal: "09:00:00", enabled: false })], null, WEEK) === null && clashingBlock(form({ start: 540, days: [5] }), list, "a", WEEK) === null
    && clashingBlock(form({ start: 540, days: [4, 5] }), list, null, WEEK)?.id === "a" && clashingBlock(form({ start: 540, repeat: "once", onceDate: "2026-11-20" }), list, null, WEEK)?.id === "a" && clashingBlock(form({ start: 540, repeat: "once", onceDate: "2026-11-21" }), list, null, WEEK) === null;
})());

// ── the screen ──
assert("S12 the week strip: seven days, Sunday first; today and the open day marked; a dot only on a day that has a block switched on", (() => {
  const strip = stripDays(WEEK, "2026-11-20", "2026-11-17", [sch("a", { daysOfWeek: [5] }), sch("off", { daysOfWeek: [2], enabled: false })]);
  return strip.length === 7 && strip[0]!.ymd === "2026-11-15" && strip[0]!.dow === 0 && strip[5]!.isToday && strip[2]!.isSelected && strip[5]!.hasBlocks && !strip[2]!.hasBlocks && !strip[0]!.hasBlocks && strip[5]!.day === 20;
})());
assert("S13 the day as a bar: a block is a part of the 24 hours; a block that is off or hidden behind another is not drawn", (() => {
  const day = buildDayScenes([sch("a", { startTimeLocal: "06:00:00", endTimeLocal: "12:00:00" }), sch("off", { startTimeLocal: "15:00:00", enabled: false })], 5, WEEK);
  const seg = barSegments(day);
  return seg.length === 1 && Math.abs(seg[0]!.left - 25) < 0.01 && Math.abs(seg[0]!.width - 25) < 0.01 && !seg[0]!.quiet;
})());
assert("S14 a row knows where it stands against the clock: playing now · the next one · over · still to come · off for the day; another day has no 'now' and no 'next'", (() => {
  const day = buildDayScenes([sch("a", { startTimeLocal: "08:00:00", endTimeLocal: "10:00:00" }), sch("b", { startTimeLocal: "12:00:00" }), sch("c", { startTimeLocal: "20:00:00" })], 5, WEEK);
  const nowMin = 11 * 60;
  const { now, next } = nowAndNext(day, nowMin);
  const ctx = { isToday: true, nowMin, playing: now, next };
  const [a, b, c] = day as [Scene, Scene, Scene];
  const off = { ...a, offDay: true } as Scene;
  return rowState(a, ctx) === "past" && rowState(b, ctx) === "next" && rowState(c, ctx) === "later" && rowState(off, ctx) === "off" && rowState(b, { ...ctx, isToday: false }) === "later"
    && rowState(a, { ...ctx, nowMin: 9 * 60, playing: nowAndNext(day, 9 * 60).now, next: nowAndNext(day, 9 * 60).next }) === "now";
})());
assert("S15 how often a block happens, as the screen words it", (() => {
  return daysTextOf(sch("a", { daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })).kind === "every" && daysTextOf(sch("a", { daysOfWeek: [1, 2, 3, 4, 5] })).kind === "weekdays" && daysTextOf(sch("a", { daysOfWeek: [5] })).kind === "custom"
    && daysTextOf(sch("a", { recurrence: "one_off", oneOffDateLocal: "2026-12-24", daysOfWeek: [] })).kind === "once" && daysTextOf(sch("a", { recurrence: "one_off", oneOffDateLocal: "2026-12-24", daysOfWeek: [] })).date === "2026-12-24";
})());
assert("S16 a block wears the colour of its music's picture (a grey picture → a calm grey); with no known colour it is one of the blues the computer starts from, the same blue for the same music every time", (() => {
  const red = blockColours({ h: 350, s: 0.6 }, "k"), grey = blockColours({ h: 220, s: 0.05 }, "k");
  const a = blockColours(null, "pl-1"), b = blockColours(null, "pl-1");
  return /^hsl\(350 /.test(red.accent) && / 8% /.test(grey.accent) && a.accent === b.accent && /^hsl\((19\d|2[0-3]\d) /.test(a.accent);
})());

// ── wiring ──
const ui = rd("components/vm/vm-schedule.tsx");
const css = rd("app/mobile-app.css");
const code = ui.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
assert("W1 everything the phone writes goes through the Studio's own routes — POST /api/schedules to add, PATCH / DELETE /api/schedules/:id to change, switch off one day or remove — and the plan is read again after each", (() => {
  const calls = [...code.matchAll(/send\("(POST|PATCH|DELETE)", ([^,)]+)/g)].map((m) => `${m[1]} ${m[2]}`);
  return calls.some((c) => /^POST "\/api\/schedules"$/.test(c)) && calls.filter((c) => /^PATCH `\/api\/schedules\/\$\{encodeURIComponent\(/.test(c)).length >= 3 && calls.some((c) => /^DELETE `\/api\/schedules\//.test(c)) && /onChanged\(/.test(code) && /reload\(\)/.test(code);
})());
assert("W2 a refused save says so in the person's words and is never shown as a success: the 'Saved' / 'Added' toast comes only after the server accepted", /if \(r\.ok\) onSaved\(f\);\s*else setRefused\(refusal\(r, tr\)\)/.test(code) && /ui\.toast\(tr\("Added to the schedule"\)\)/.test(code) && /ui\.toast\(tr\("Saved"\)\)/.test(code) && /if \(r\.status === 403\) return tr\("You don't have permission/.test(code));
assert("W3 removing asks first (a second step: 'Remove this block?' with 'Keep it'), and offers 'this day only' / 'every day' when the block plays on several days", /mode === "remove"/.test(code) && /tr\("Remove this block\?"\)/.test(code) && /tr\("Keep it"\)/.test(code) && /canRemoveOneDay\(sc, dow\)/.test(code) && /daysOfWeek: daysWithout\(sc, dow\)/.test(code));
assert("W4 the save refuses a clash (two blocks on one minute) and an incomplete form BEFORE it asks the server", /const p = formProblem\(f\) \?\? \(clash \? "clash" : null\);\s*if \(p\) \{\s*setProblem\(p\);\s*return;\s*\}/.test(code) && /clashingBlock\(f, schedules, editingId, weekDates\)/.test(code));
assert("W5 the switch 'plays on this day' (one day off, PATCH skipDates) is still on a block's sheet", /skipDates: withSkipDate\(dates, dateStr, !off, dateKey\(new Date\(\)\)\)/.test(code) && /role="switch"/.test(code));
const keys = [...code.matchAll(/\btr\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"'));
const missing = [...new Set(keys)].filter((k) => !(k in HE_PHRASES));
assert(`W6 every line of the schedule is translated to Hebrew${missing.length ? ` (missing: ${missing.join(" | ")})` : ""}`, missing.length === 0);
const sch_css = css.split("\n").filter((l) => /^\.vm-sch/.test(l) || /^\[dir="rtl"\] \.vm-sch/.test(l)).join("\n");
assert("W7 the schedule's CSS uses logical properties only (Hebrew runs from the right): no left / right, no margin-left / margin-right, no padding-left / padding-right, no text-align left / right", sch_css.length > 2000 && !/(^|[;{ ])(left|right)\s*:/.test(sch_css) && !/(margin|padding)-(left|right)/.test(sch_css) && !/text-align:\s*(left|right)/.test(sch_css));
assert("W8 fewer frames: the schedule draws no border, no ring and no outline — a block is a row, the one that plays is lifted", !/(^|[;{ ])border(-(top|bottom|left|right|inline|block)(-\w+)?)?\s*:\s*[^\s0n;]/.test(sch_css) && !/inset 0 0 0/.test(sch_css) && !/outline\s*:/.test(sch_css));
assert("W9 the old pixel board is gone (no dead code): its component and its CSS", !/vm-day-board|\.vm-day-/.test(css) && !existsSync(path.join(root, "components/vm/vm-day-board.tsx")));

console.log(`\n${pass} passed, ${fail} failed`);
