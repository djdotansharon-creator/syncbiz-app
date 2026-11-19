/**
 * A SCHEDULED JINGLE CAN BE EDITED, AND "EVERY DAY AT A TIME" REALLY FIRES EVERY DAY (owner 2026-11-19):
 *  - "I have no control over a jingle I set a time for — I can't change its time or make it every day at a specific time"
 *      → every row of the Jingles screen's Schedule tab has "Edit": the schedule's own screen opens on what it is now (kind, time, days / date); Save REPLACES it (same id);
 *      → a fixed-days schedule ("weekdays": the dialog's default, "every day" included) used to be due only on the weekday it was first scheduled (lastFiringMs counted it as a weekly
 *        item — baseline "PARKED 3", PROVEN BY TEST): a jingle set to "every day at 12:30" fired once a week. Now the latest chosen day whose time has passed is the due one.
 *  - the Schedules screen's jingle marker says "Edit" (not "Open in Jingles") and lands on THAT jingle's own settings.
 * Behavioural tests of the pure rules + static guards of the wiring.
 * Run: TZ=Asia/Jerusalem npx tsx scripts/verify-jingle-edit.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { lastFiringMs, nextFiringMs } from "../components/jingles-control/schedule-storage";
import { editDefaults } from "../components/jingles-control/jingle-schedule-dialog";
import type { MockScheduleItem } from "../components/jingles-control/types";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

// local dates: Thu 19 Nov 2026 (a Thursday) …
const at = (d: number, h: number, m: number, s = 0) => new Date(2026, 10, d, h, m, s).getTime();
const fixed = (days: number[], time: string, savedAt: number): MockScheduleItem => {
  const probe: MockScheduleItem = { id: "j", label: "Closing soon", whenLabel: "", repeatLabel: "", targetLabel: "Queue", url: "/a.mp3", repeat: "weekdays", days, timeOfDay: time };
  const next = nextFiringMs(probe, savedAt);
  return { ...probe, scheduledAtIso: next ? new Date(next).toISOString() : undefined };
};
const dueNow = (it: MockScheduleItem, now: number) => { const d = lastFiringMs(it, now); return d !== null && now - d <= 15_000; };

// ── every day at 12:30, first scheduled on a Thursday ──
const everyDay = fixed([0, 1, 2, 3, 4, 5, 6], "12:30", at(19, 10, 0));
assert("J1 every day at 12:30: due on the first day (Thursday)", dueNow(everyDay, at(19, 12, 30, 2)));
assert("J2 …and on Friday (it used to be due only on the weekday it was first scheduled)", dueNow(everyDay, at(20, 12, 30, 2)));
assert("J3 …and on Saturday and every day after", dueNow(everyDay, at(21, 12, 30, 2)) && dueNow(everyDay, at(22, 12, 30, 2)) && dueNow(everyDay, at(25, 12, 30, 2)));
assert("J4 …and not at another time of day", !dueNow(everyDay, at(20, 13, 0, 0)) && !dueNow(everyDay, at(20, 12, 29, 59)));

// ── chosen days only ──
const monWed = fixed([1, 3], "09:15", at(19, 10, 0)); // first firing: Monday 23 Nov
assert("J5 Monday + Wednesday at 09:15: due on Monday and on Wednesday", dueNow(monWed, at(23, 9, 15, 3)) && dueNow(monWed, at(25, 9, 15, 3)));
assert("J6 …and NOT on Tuesday / Thursday / the weekend", !dueNow(monWed, at(24, 9, 15, 3)) && !dueNow(monWed, at(26, 9, 15, 3)) && !dueNow(monWed, at(28, 9, 15, 3)));
assert("J7 the next firing is the matching day / time (the timer that wakes the player)", nextFiringMs(monWed, at(23, 9, 16)) === at(25, 9, 15));

// ── never before the first firing ──
const justSaved = fixed([0, 1, 2, 3, 4, 5, 6], "12:30", at(19, 12, 30, 5)); // saved 5 s AFTER 12:30 → first firing is tomorrow
assert("J8 saving at 12:30:05 for 12:30 does not fire on the spot (nothing before the first firing counts)", !dueNow(justSaved, at(19, 12, 30, 10)) && dueNow(justSaved, at(20, 12, 30, 2)));

// ── the other kinds are untouched ──
const once: MockScheduleItem = { id: "o", label: "x", whenLabel: "", repeatLabel: "Once", targetLabel: "Queue", url: "/a.mp3", repeat: "once", scheduledAtIso: new Date(at(20, 18, 45)).toISOString() };
const daily: MockScheduleItem = { id: "d", label: "x", whenLabel: "", repeatLabel: "", targetLabel: "Queue", url: "/a.mp3", repeat: "daily", scheduledAtIso: new Date(at(19, 13, 5)).toISOString() };
const weekly: MockScheduleItem = { id: "w", label: "x", whenLabel: "", repeatLabel: "", targetLabel: "Queue", url: "/a.mp3", repeat: "weekly", scheduledAtIso: new Date(at(19, 16, 20)).toISOString() };
assert("J9 one-time / daily / weekly behave as before", lastFiringMs(once, at(20, 18, 45, 1)) === at(20, 18, 45) && lastFiringMs(once, at(20, 18, 44)) === null
  && lastFiringMs(daily, at(22, 13, 5, 1)) === at(22, 13, 5) && lastFiringMs(weekly, at(26, 16, 20, 1)) === at(26, 16, 20) && lastFiringMs(weekly, at(22, 16, 20, 1)) === at(19, 16, 20));

// ── what the edit screen opens on ──
const now = at(19, 10, 0);
{
  const d = editDefaults(everyDay, now);
  assert("J10 editing 'every day at 12:30' opens on Fixed · 12:30 · all seven days", d.mode === "fixed" && d.hour === 12 && d.minute === 30 && d.days.length === 7);
  const m = editDefaults(monWed, now);
  assert("J11 editing 'Mon + Wed at 09:15' opens on exactly those days and that time", m.mode === "fixed" && m.hour === 9 && m.minute === 15 && m.days.join() === "1,3");
  const o = editDefaults(once, now);
  assert("J12 editing a one-time opens on One-time, its time, and the date as 'days from today' (tomorrow = 1)", o.mode === "once" && o.hour === 18 && o.minute === 45 && o.dateOffset === 1);
  const past = editDefaults({ ...once, scheduledAtIso: new Date(at(10, 8, 0)).toISOString() }, now);
  assert("J13 a one-time date that has passed opens on today (never a negative offset)", past.mode === "once" && past.dateOffset === 0);
  const dl = editDefaults(daily, now);
  const wk = editDefaults(weekly, now);
  assert("J14 an older 'daily' item opens as every day; an older 'weekly' item opens on its own weekday", dl.mode === "fixed" && dl.days.length === 7 && dl.hour === 13 && dl.minute === 5 && wk.mode === "fixed" && wk.days.join() === "4" && wk.hour === 16 && wk.minute === 20);
  const seedDaily = editDefaults({ id: "sch-1", label: "Fresh bread — morning", whenLabel: "Tomorrow 08:00", repeatLabel: "Daily", targetLabel: "This branch" }, now);
  const seedWeekly = editDefaults({ id: "sch-2", label: "Weekend sale teaser", whenLabel: "Fri 17:30", repeatLabel: "Weekly", targetLabel: "This branch" }, now);
  assert("J15 the first-run example rows (only words: 'Daily', 'Weekly', 'Fri 17:30') open as the kind and time their words say", seedDaily.mode === "fixed" && seedDaily.days.length === 7 && seedDaily.hour === 8 && seedDaily.minute === 0 && seedWeekly.mode === "fixed" && seedWeekly.days.join() === "5" && seedWeekly.hour === 17 && seedWeekly.minute === 30);
}

// ── wiring ──
const dlg = rd("components/jingles-control/jingle-schedule-dialog.tsx");
const shell = rd("components/jingles-control/JinglesShell.tsx");
const tab = rd("components/jingles-control/open-tab.ts");
const studio = rd("components/schedules-studio/schedules-studio.tsx");
const phrases = rd("lib/i18n/phrases.ts");
assert("J16 Save on an edit REPLACES the schedule (same id — a pad's link and the studio's marker stay) and never adds a second one", /persistJingleSchedule\(branch, edit && all\.some\(\(x\) => x\.id === edit\.id\) \? all\.map\(\(x\) => \(x\.id === edit\.id \? item : x\)\) : \[\.\.\.all, item\]\)/.test(dlg) && /\? \{ id: edit\.id, label: edit\.label, targetLabel: edit\.targetLabel, url: edit\.url, preRoll: edit\.preRoll, bellStyle: edit\.bellStyle \}/.test(dlg));
assert("J17 the edit screen opens on the schedule's own values and says 'Save' (a new one still opens on the next free slot and says 'Schedule')", /const d0 = edit \? editDefaults\(edit, nowMs0\) : null;/.test(dlg) && /edit \? tr\("Save"\) : tr\("Schedule"\)/.test(dlg) && /d0\?\.hour \?\? slot0\.getHours\(\)/.test(dlg));
assert("J18 every row of the Schedule tab has 'Edit' (a named button — and the row itself opens it); the × is unchanged apart from not opening it", /className="jcs-row jcs-row--edit"[^>]*onClick=\{\(\) => setEditItem\(si\)\}/.test(shell) && /className="jcs-edit"[\s\S]{0,160}\{tr\("Edit"\)\}/.test(shell) && /className="jcs-x"\s*onClick=\{\(e\) => \{ e\.stopPropagation\(\); setSchedItems\(\(prev\) => prev\.filter/.test(shell));
assert("J19 the edit screen is a second instance of the same dialog (the add-schedule path is untouched)", /<JingleScheduleDialog\s+key=\{editItem\.id\}\s+edit=\{editItem\}/.test(shell) && /inline=\{scheduleInline \?\? undefined\}/.test(shell));
assert("J20 the Schedules screen hands over the jingle's id: the marker's card says 'Edit' and opens that jingle's own settings on the Jingles screen's Schedule tab", /setJinglesOpenTab\("schedule"\);\s*setJinglesOpenEdit\(id\);\s*router\.push\("\/jingles"\)/.test(studio) && /<span>\{tr\("Edit"\)\}<\/span>/.test(studio) && !/Open in Jingles/.test(studio));
assert("J21 the hand-off works when the Jingles screen is not open yet (taken on mount) and when it already is (event); the item opens once it is in the list", /takeJinglesOpenEdit\(\)/.test(shell) && /JINGLES_OPEN_EDIT_EVENT/.test(shell) && /export function setJinglesOpenEdit/.test(tab) && /export function takeJinglesOpenEdit/.test(tab) && /schedItems\.find\(\(x\) => x\.id === editWanted\)/.test(shell));
assert("J22 the studio still never writes the jingle list", !/persistJingleSchedule/.test(studio));
assert("J23 the new line is translated", /"Edit schedule": "/.test(phrases) && /"Edit": "עריכה"/.test(phrases));
assert("J24 the fixed-days rule is in ONE place and the timer uses the same days: lastFiringMs and nextFiringMs both read `days` / `timeOfDay`", /if \(item\.repeat === "weekdays"\) \{\s*const days = item\.days && item\.days\.length > 0 \? item\.days : \[0, 1, 2, 3, 4, 5, 6\];\s*const \[hh, mm\] = \(item\.timeOfDay \?\? "00:00"\)[\s\S]{0,400}for \(let back = 0; back < 8; back\+\+\)/.test(rd("components/jingles-control/schedule-storage.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
