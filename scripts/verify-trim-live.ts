/**
 * Cutting a song's block is drawn LIVE (owner 2026-11-17: "when I shorten or lengthen a song's block I see the reaction late; live it does not move with my mouse at all").
 * ROOT CAUSE (PROVEN BY RUNTIME + CODE): the block being dragged is drawn as a "floating" scene, and `buildDayScenes` gave that scene a floor of 5 minutes — left over from when no block could be
 * cut under 5 minutes. Since 2026-11-16 the strips cut down to the zoom's step (a minute), so while a block was cut to 1–4 minutes it stayed drawn at 5 and jumped to its true length only after release.
 * Run: npx tsx scripts/verify-trim-live.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDayScenes } from "../lib/schedules-timeline";
import type { Schedule } from "../lib/types";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else fail++;
}

const sched = (over: Partial<Schedule>): Schedule =>
  ({
    id: "a", workspaceId: "w", branchId: "default", name: "Song", targetType: "PLAYLIST", targetId: "p", recurrence: "weekly", daysOfWeek: [1], startTimeLocal: "10:00:00", endTimeLocal: "23:59:00",
    enabled: true, priority: 1, timezone: "UTC", status: "ACTIVE", createdAt: "", updatedAt: "", ...over,
  }) as unknown as Schedule;
const week = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"];
const len = (s: Schedule, floating?: string) => {
  const sc = buildDayScenes([s], 1, week, () => 5, floating).find((x) => x.schedule.id === s.id)!;
  return sc.end - sc.start;
};

// the song is 4:22 → its block is 5 minutes; the strip cuts it to 4, 3, 2, 1 minutes while the mouse is down
for (const m of [4, 3, 2, 1]) {
  const cut = sched({ endTimeLocal: `10:0${m}:00` });
  assert(`L${5 - m} cut to ${m} min: drawn ${m} min while the mouse is down (floating) — and the same at rest`, len(cut, "a") === m && len(cut) === m);
}
assert("L5 a block that is not cut keeps the music's own length while carried (5 min)", len(sched({}), "a") === 5);
assert("L6 a quiet block carried keeps its own end", (() => { const q = sched({ targetType: "SILENCE", targetId: "silence", endTimeLocal: "11:30:00" }); return len(q, "a") === 90; })());
assert("L7 nothing is drawn shorter than a minute (a one-minute end after the start)", len(sched({ endTimeLocal: "10:01:00" }), "a") === 1);

const tl = rd("lib/schedules-timeline.ts");
assert("L8 the floor is one minute, not five (the old floor is gone)", /Math\.max\(start \+ 1, end\)/.test(tl) && !/Math\.max\(start \+ 5, end\)/.test(tl));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
