/**
 * A window runs only its own branch's schedules (2026-11-15, owner: "the schedule I set for one player affects all the other players").
 * Run: npx tsx scripts/verify-schedule-branch-scope.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { schedulesForBranch } from "../lib/schedule-branch-scope";
import { decideScheduleAction } from "../lib/schedule-actions";
import type { Schedule } from "../lib/types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const mk = (id: string, branchId: string | undefined, start: string): Schedule => ({
  id, accountId: "a", name: id, branchId: branchId as string, targetType: "PLAYLIST", targetId: "pl-" + id, recurrence: "weekly", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTimeLocal: start, endTimeLocal: "23:59", enabled: true, priority: 1,
} as Schedule);
const ids = (l: Schedule[]) => l.map((s) => s.id).join(",");

const A = "branch-A", B = "branch-B";
const known = new Set([A, B]);
const two = [mk("a-morning", A, "08:00:00"), mk("b-noon", B, "12:00:00"), mk("a-evening", A, "18:00:00")];

assert("BS1 two real branches: a window of A runs A's blocks only, a window of B runs B's only",
  ids(schedulesForBranch(two, A, { canonicalDefaultBranchId: null, knownBranchIds: known })) === "a-morning,a-evening" && ids(schedulesForBranch(two, B, { canonicalDefaultBranchId: null, knownBranchIds: known })) === "b-noon");

// the bug, as it was: the engine given everything starts B's block in A's window; given A's schedules only, it starts A's
const now = new Date(2026, 10, 15, 12, 5);
const before = decideScheduleAction({ schedules: two, now, hasFired: () => false });
const after = decideScheduleAction({ schedules: schedulesForBranch(two, A, { canonicalDefaultBranchId: null, knownBranchIds: known }), now, hasFired: () => false });
assert("BS2 the old behaviour started branch B's block in a window of branch A (the bug); with the filter that window starts its own branch's block", before?.kind === "start" && before.schedule.id === "b-noon" && after?.kind === "start" && after.schedule.id === "a-morning");

// a quiet / closing block of one branch must not silence the others
const closeB = { ...mk("b-closing", B, "12:00:00"), targetType: "SILENCE", targetId: "silence" } as Schedule;
const stopA = decideScheduleAction({ schedules: schedulesForBranch([mk("a-morning", A, "08:00:00"), closeB], A, { canonicalDefaultBranchId: null, knownBranchIds: known }), now, hasFired: (k) => k.includes("a-morning") });
assert("BS3 branch B's closing (quiet) block does not stop branch A's music", stopA === null);

// the legacy key "default" is the business's canonical branch when it has one
const mixed = [mk("legacy", "default", "08:00:00"), mk("canon", A, "09:00:00"), mk("other", B, "10:00:00"), mk("blank", undefined, "11:00:00")];
assert("BS4 with a canonical branch for 'default' (= A): A's window runs the 'default' and blank ones too, B's window does not",
  ids(schedulesForBranch(mixed, A, { canonicalDefaultBranchId: A, knownBranchIds: known })) === "legacy,canon,blank" && ids(schedulesForBranch(mixed, B, { canonicalDefaultBranchId: A, knownBranchIds: known })) === "other"
  && ids(schedulesForBranch(mixed, "default", { canonicalDefaultBranchId: A, knownBranchIds: known })) === "legacy,canon,blank");

// the accepted single-branch pilot: everything is 'default', the window is 'default' → unchanged
const pilot = [mk("p1", "default", "08:00:00"), mk("p2", "default", "12:00:00"), mk("p3", undefined, "17:00:00")];
assert("BS5 single-branch parity: a legacy 'default' window runs every 'default' / blank schedule exactly as before (with or without a canonical branch, with or without other branches)",
  ids(schedulesForBranch(pilot, "default", { canonicalDefaultBranchId: null, knownBranchIds: new Set() })) === "p1,p2,p3"
  && ids(schedulesForBranch(pilot, "default", { canonicalDefaultBranchId: A, knownBranchIds: known })) === "p1,p2,p3"
  && ids(schedulesForBranch(pilot, "default", { canonicalDefaultBranchId: null, knownBranchIds: known })) === "p1,p2,p3");

// fail-open: a schedule of no real branch of this business (orphan / unmapped legacy key) still runs, as it always did; a real OTHER branch's does not
const odd = [mk("orphan", "branch-from-nowhere", "08:00:00"), mk("theirs", B, "09:00:00"), mk("legacy", "default", "10:00:00")];
assert("BS6 fail-open: an orphan branch id (and 'default' when the business has no canonical branch) is still run; a real other branch's block is not",
  ids(schedulesForBranch(odd, A, { canonicalDefaultBranchId: null, knownBranchIds: known })) === "orphan,legacy");

const auto = rd("components/schedule-auto-player.tsx");
const route = rd("app/api/schedules/route.ts");
assert("BS7 the engine asks the server for its own branch only (waits while this window's branch is unknown), and the list route filters only when asked (`?branchId=`; the studio and the lists are untouched)",
  /const branch = stationBranchIdNow\(\);\n\s*if \(branch === null\) return;/.test(auto) && /fetch\(`\/api\/schedules\?branchId=\$\{encodeURIComponent\(branch\)\}`/.test(auto) && /useStationBranchId\(\)/.test(auto)
  && /export async function GET\(req: NextRequest\)/.test(route) && /const wanted = \(req\.nextUrl\.searchParams\.get\("branchId"\) \?\? ""\)\.trim\(\);\n\s*if \(wanted\) \{/.test(route) && /schedulesForBranch\(filtered, wanted,/.test(route) && /return NextResponse\.json\(filtered\);\n\}/.test(route));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
