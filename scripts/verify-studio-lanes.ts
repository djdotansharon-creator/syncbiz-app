/**
 * STUDIO ROWS + THE BRANCH A BLOCK IS STAMPED WITH (owner 2026-11-22). Field test 2026-11-21: on the Lenovo (branch Lenovo-Pailot) the Studio showed one row — only branches that
 * already had blocks — and a dropped playlist took the playlist's own branch ("default"), where the Lenovo never looks. Now this window's own branch always has a row, and a playlist
 * dropped on a row is stamped with that row's branch. Pure helpers (lib/schedules-lanes.ts) + the Studio's wiring.
 * Run: npx tsx scripts/verify-studio-lanes.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { blockBranchFor, laneBranchIds } from "../lib/schedules-lanes";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const NAMES: Record<string, string> = { default: "Default", "70227520-x": "Lenovo-Pailot", "b-2": "VONO-M" };
const nameOf = (id: string) => NAMES[id] ?? id;
const known = ["70227520-x", "b-2"];

const a = laneBranchIds({ blockBranches: ["default"], stationBranch: "70227520-x", knownBranchIds: known, nameOf });
assert("L1 the Lenovo's own branch gets a row even with no block in it (this is the row that was missing), sorted by name", JSON.stringify(a) === JSON.stringify(["default", "70227520-x"]), JSON.stringify(a));
assert("L2 a branch that already has blocks is not doubled; the legacy 'default' counts as a real branch for a window that has never been activated", JSON.stringify(laneBranchIds({ blockBranches: ["default", "70227520-x"], stationBranch: "70227520-x", knownBranchIds: known, nameOf })) === JSON.stringify(["default", "70227520-x"]) && JSON.stringify(laneBranchIds({ blockBranches: ["b-2"], stationBranch: "default", knownBranchIds: known, nameOf })) === JSON.stringify(["default", "b-2"]));
assert("L3 an unknown branch id, an empty one and null are NOT added (no ugly row labelled with a raw id)", JSON.stringify(laneBranchIds({ blockBranches: ["default"], stationBranch: "zzz", knownBranchIds: known, nameOf })) === JSON.stringify(["default"]) && JSON.stringify(laneBranchIds({ blockBranches: ["default"], stationBranch: null, knownBranchIds: known, nameOf })) === JSON.stringify(["default"]) && JSON.stringify(laneBranchIds({ blockBranches: ["default"], stationBranch: "  ", knownBranchIds: known, nameOf })) === JSON.stringify(["default"]));
assert("L4 no block at all: the window's own branch still has its row", JSON.stringify(laneBranchIds({ blockBranches: [], stationBranch: "70227520-x", knownBranchIds: known, nameOf })) === JSON.stringify(["70227520-x"]));

assert("L5 a quiet / bank block belongs to the row it was added in, else the quiet branch (unchanged)", blockBranchFor({ targetType: "SILENCE", laneBranch: "b-2", itemBranch: "", quietBranch: "default" }) === "b-2" && blockBranchFor({ targetType: "BANK", itemBranch: "", quietBranch: "default" }) === "default");
assert("L6 a PLAYLIST dropped on a row takes THAT row's branch (new); with no row (week view, a single row) it keeps its own branch (unchanged)", blockBranchFor({ targetType: "PLAYLIST", laneBranch: "70227520-x", itemBranch: "default", quietBranch: "default" }) === "70227520-x" && blockBranchFor({ targetType: "PLAYLIST", itemBranch: "default", quietBranch: "x" }) === "default");
assert("L7 a song and a radio station are UNCHANGED: always their own branch, whatever row they were dropped on", blockBranchFor({ targetType: "SOURCE", laneBranch: "b-2", itemBranch: "default", quietBranch: "x" }) === "default" && blockBranchFor({ targetType: "RADIO", laneBranch: "b-2", itemBranch: "default", quietBranch: "x" }) === "default");

const studio = rd("components/schedules-studio/schedules-studio.tsx");
const code = studio.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
assert("L8 the Studio uses the helpers: the day rows and the branch filter come from laneIds; a new block is stamped by blockBranchFor", /const laneIds = useMemo\(\(\) => laneBranchIds\(\{ blockBranches: branchIds, stationBranch,/.test(code) && /branchFilter !== "all" \? \[branchFilter\] : laneIds\.length > 0 \? laneIds/.test(code) && /laneIds\.length > 1 \?/.test(code) && /laneIds\.map\(\(id\) => <option/.test(code) && /branchId: blockBranchFor\(\{ targetType: item\.targetType, laneBranch: branchId,/.test(code));
assert("L9 what else uses the branches is UNCHANGED: the quiet branch still comes from the branches that have blocks, and the business-hours list is as before", /const quietBranch = branchFilter !== "all" \? branchFilter : branchIds\[0\] \?\? branches\[0\]\?\.id \?\? "default";/.test(code) && /new Set\(\[\.\.\.branches\.map\(\(b\) => b\.id\), \.\.\.branchIds\]\)/.test(code));
assert("L10 a drop passes the row only when there is more than one row (unchanged), so the week view and a single-row day keep their old behaviour", /trackDrop\(e, focusDay, "h", dayRows\.length > 1 \? row\.id : undefined\)/.test(code));
assert("L11 the pure helpers import nothing (no playback, no store)", !/^import /m.test(rd("lib/schedules-lanes.ts")));
console.log(`\n${pass} passed, ${fail} failed`);
