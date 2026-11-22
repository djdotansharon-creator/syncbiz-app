/**
 * CLOSINGS — SEVERAL PER DAY (owner 2026-11-22: "I set the hours — why does a closing at 12 at night do nothing? the last song plays on"). Root cause (PROVEN BY CODE): `closingPlan` holds ONE minute per
 * calendar day and skipped a close of 00:00 (it is "the end of the day", not a minute of it), so no quiet "Closing" block was made and the last song kept playing all night; an evening that runs into
 * the next morning next to an ordinary one also lost a closing (both want the same day's single slot). `closingMinutes` lets a day hold several; the Studio saves from it.
 * Run: npx tsx scripts/verify-closing-minutes.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { closingMinutes, closingPlan, type BizHours } from "../lib/schedules-timeline";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const J = JSON.stringify;
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const same = (o: number, c: number): BizHours => ({ h24: false, same: true, all: { open: o, close: c }, days: [] });
const per = (days: ({ open: number; close: number } | null)[]): BizHours => ({ h24: false, same: false, all: { open: 480, close: 1380 }, days });
const all = (m: number[]) => J([m, m, m, m, m, m, m]);

assert("M1 an ordinary evening (08:00–22:00): every day closes at 22:00 on its own day — as before", J(closingMinutes(same(480, 1320))) === all([1320]) && J(closingMinutes(same(480, 1320))) === J(closingPlan(same(480, 1320)).map((m) => [m])));
assert("M2 CLOSING AT MIDNIGHT (08:00–00:00): every day gets a Closing at 00:00 — the one that was missing (it lands on the NEXT calendar day, which is when the music must stop)", J(closingMinutes(same(480, 0))) === all([0]) && closingPlan(same(480, 0)).every((m) => m === null), "closingPlan gave none");
assert("M3 a night business (18:00 → 02:00): every day gets its Closing at 02:00 (the evening ends the next morning)", J(closingMinutes(same(1080, 120))) === all([120]));
const mixed = per([null, { open: 1080, close: 120 }, { open: 480, close: 1380 }, null, null, null, null]);
assert("M4 an overnight evening next to an ordinary one keeps BOTH closings (Monday 18:00 → 02:00 and Tuesday 08:00 → 23:00: Tuesday goes quiet at 02:00 and at 23:00) — one used to be lost", J(closingMinutes(mixed)[2]) === "[120,1380]");
assert("M5 a closed day is quiet from midnight; when last night's hours still run into this morning it goes quiet when they end", J(closingMinutes(per([null, { open: 480, close: 1380 }, null, null, null, null, null]))[2]) === "[0]" && J(closingMinutes(mixed)[2]).includes("120") && J(closingMinutes(per([null, { open: 1080, close: 120 }, null, null, null, null, null]))[2]) === "[120]");
assert("M6 round the clock has no closing", J(closingMinutes({ h24: true, same: true, all: { open: 0, close: 1440 }, days: [] })) === all([]));
assert("M7 a day that opens at 00:00 right after a midnight close is continuous — Monday gets only its own 23:00 closing, no 00:00 between Sunday night and Monday", J(closingMinutes(per([{ open: 480, close: 0 }, { open: 0, close: 1380 }, null, null, null, null, null]))[1]) === "[1380]");
const friSat = per([null, null, null, null, null, { open: 480, close: 0 }, null]);
assert("M8 Friday closes at midnight and Saturday is closed: Saturday gets ONE quiet block at 00:00 (not two)", J(closingMinutes(friSat)[6]) === "[0]");
assert("M9 minutes are unique and sorted, every one inside 00:00–23:59", [same(480, 1320), same(480, 0), same(1080, 120), mixed, friSat].every((b) => closingMinutes(b).every((ms) => J(ms) === J([...new Set(ms)].sort((a, c) => a - c)) && ms.every((m) => m >= 0 && m < 1440))));
assert("M10 `closingPlan` is exactly as it was (kept for the old tests): 22:00 every day; closed day 00:00; night 05:00", closingPlan(same(480, 1320)).every((m) => m === 1320) && closingPlan(per([null, { open: 480, close: 1380 }, null, null, null, null, null]))[0] === 0 && closingPlan(same(840, 300)).every((m) => m === 300));

const tsx = rd("components/schedules-studio/schedules-studio.tsx");
assert("W1 the dialog saves from closingMinutes; saveClosing takes several minutes per day and still makes one weekly quiet block per DISTINCT time (days that share a time share a block), new ones first, the old ones removed after", /return saveClosing\(branchId, closingMinutes\(next\)\);/.test(tsx) && /desired: number\[\]\[\]/.test(tsx) && /for \(const m of minutes\) groups\.set\(m, \[\.\.\.\(groups\.get\(m\) \?\? \[\]\), d\]\)/.test(tsx) && tsx.indexOf("for (const g of toCreate)") < tsx.indexOf("if (!(await removeNow(e.id))) return false;"));
assert("W2 nothing else changed in how a closing block is made: still a weekly SILENCE block named Closing, start = the minute, enabled", /name: CLOSING_NAME, branchId, targetType: "SILENCE", targetId: "silence", recurrence: "weekly", daysOfWeek: g\.days, startTimeLocal: minutesToTimeLocal\(g\.m\)/.test(tsx));

console.log(`\n${pass} passed, ${fail} failed`);
