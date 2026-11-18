/**
 * Evidence for "why did the schedule not play" (2026-11-18 audit, F2): (1) the schedule engine's log lines reach main.log (the desktop mirrors ONLY renderer warnings / errors — they used to be
 * `console.info`, so none of them ever did), (2) the engine writes which branch's schedule this station follows and how many blocks of the business belong to other branches (a block of another
 * branch silently never starts here since 2026-11-16). PURE checks of `scheduleScopeNote` + static wiring. Nothing here plays or stops anything.
 * Run: npx tsx scripts/verify-schedule-diag.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { scheduleScopeNote } from "../lib/schedule-branch-scope";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

assert("N1 an older server that says nothing → no line (null)", scheduleScopeNote({ branch: "b1", blocks: 3, enabled: true, otherBranches: null }) === null);
assert("N2 all blocks belong to this branch → one plain line", scheduleScopeNote({ branch: "b1", blocks: 3, enabled: true, otherBranches: 0 }) === 'this station follows branch "b1": 3 block(s), schedule switch ON');
const w = scheduleScopeNote({ branch: "b1", blocks: 0, enabled: true, otherBranches: 5 })!;
assert("N3 NO block for this branch but blocks of other branches exist, switch on → the line says NOTHING WILL START and how many belong elsewhere", /^NOTHING WILL START FROM THE SCHEDULE here — /.test(w) && /5 other block\(s\)/.test(w), w);
const m = scheduleScopeNote({ branch: "b1", blocks: 2, enabled: true, otherBranches: 4 })!;
assert("N4 some blocks here, others elsewhere → the count, without the 'nothing will start' warning", !/NOTHING/.test(m) && /4 other block\(s\)/.test(m), m);
assert("N5 the switch OFF is stated, and 'nothing will start' is not claimed for an off switch (it is off on purpose)", /schedule switch OFF/.test(scheduleScopeNote({ branch: "b1", blocks: 0, enabled: false, otherBranches: 2 })!) && !/NOTHING/.test(scheduleScopeNote({ branch: "b1", blocks: 0, enabled: false, otherBranches: 2 })!));

const eng = rd("components/schedule-auto-player.tsx");
assert("D1 every `[VONO schedule]` line is a console.warn (main.log mirrors only warnings / errors) — none is left as console.info", !/console\.info\(`\[VONO schedule\]/.test(eng) && (eng.match(/console\.warn\(`\[VONO schedule\]/g) ?? []).length >= 9);
assert("D2 the engine reads the scope header and writes the note only when it changes", /x-schedules-other-branches/.test(eng) && /scheduleScopeNote\(\{ branch, blocks: Array\.isArray\(schedules\)/.test(eng) && /note !== lastScopeNote\.current/.test(eng));
const api = rd("app/api/schedules/route.ts");
assert("D3 the server says how many of the caller's blocks were left out for another branch (only on a branch-scoped request)", /X-Schedules-Other-Branches/.test(api) && /filtered\.length - scoped\.length/.test(api));
const mainIdx = rd("desktop/src/main/index.ts");
assert("D4 (premise) the desktop mirrors only level >= 2 (warning / error) renderer console lines into main.log", /if \(level < 2\) return;/.test(mainIdx) && /renderer console \(/.test(mainIdx));

console.log(`\n${pass} passed, ${fail} failed`);
