/**
 * CONTROL ROOM — the people of a branch (owner 2026-11-15): lib/branch-people.ts + the wiring on the branch screen.
 * Run: npx tsx scripts/verify-branch-people.ts
 */
import { readFileSync } from "node:fs";
import { splitBranchPeople, type BranchPersonBase, type BranchAccountBase } from "../lib/branch-people";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m); } };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const P = (name: string, email: string, level: BranchPersonBase["level"] = "member", status: BranchPersonBase["status"] = "active"): BranchPersonBase => ({ name, email, level, status });
const U = (email: string, accessType: BranchAccountBase["accessType"], branchIds: string[]): BranchAccountBase => ({ email, accessType, branchIds });

const people = [
  P("Noa", "noa@x.test"), P("Dan", "dan@x.test"), P("Maya", "maya@x.test"), P("Tom", "tom@x.test", "member", "paused"), P("Amit", "amit@x.test"), P("Lone", "lone@x.test"),
  P("Boss", "boss@x.test", "owner"), P("Mgr", "mgr@x.test", "manager"), P("Adm", "adm@x.test", "member"),
];
const accounts = [
  U("noa@x.test", "BRANCH_USER", ["A"]), U("dan@x.test", "BRANCH_USER", ["A"]), U("maya@x.test", "BRANCH_USER", ["A", "B"]), U("tom@x.test", "BRANCH_USER", ["A"]), U("amit@x.test", "BRANCH_USER", ["B"]),
  U("lone@x.test", "BRANCH_USER", []), U("boss@x.test", "OWNER", []), U("mgr@x.test", "OWNER", []), U("ADM@x.test", "OWNER", []),
];

console.log("BP1 — a branch lists exactly the members given that branch");
const a = splitBranchPeople(people, accounts, "A");
ok(a.assigned.map((x) => x.name).join(",") === "Dan,Maya,Noa,Tom", "branch A: Dan, Maya, Noa, then the paused Tom last");
ok(splitBranchPeople(people, accounts, "B").assigned.map((x) => x.name).join(",") === "Amit,Maya", "branch B: Amit, Maya (Maya has both branches)");
ok(splitBranchPeople(people, accounts, "C").assigned.length === 0, "a branch nobody was given → empty (never 'everyone')");

console.log("BP2 — owners and managers are listed apart, on every branch");
ok(a.everyBranch.map((x) => x.name).join(",") === "Adm,Boss,Mgr", "owner, manager and an OWNER-access member (matched by e-mail, any case) → everyBranch");
ok(splitBranchPeople(people, accounts, "C").everyBranch.length === 3, "…also for a branch nobody was given");
ok(!a.assigned.some((x) => x.level !== "member"), "an owner / manager is never in 'assigned'");

console.log("BP3 — a member with no branches, or another branch only, is in neither list");
ok(!a.assigned.some((x) => x.name === "Lone") && !a.everyBranch.some((x) => x.name === "Lone"), "Lone (no branches) appears nowhere");
ok(!a.assigned.some((x) => x.name === "Amit"), "Amit (branch B only) is not on A");
ok(splitBranchPeople(people, [], "A").assigned.length === 0, "no account rows at all → nobody assigned (fail closed)");

console.log("BP4 — wiring: the strip and its full screen on the branch screen");
const view = read("components/control-room/all-branches-view.tsx");
ok(/headerEnd=\{<BranchPeople\s+key=\{`ppl-\$\{open\.id\}`\}\s+branchId=\{open\.id\}\s+onSeeMore=\{\(\) => setPeopleFor\(open\.id\)\}/.test(view) && /\{headerEnd\}\s+<BranchMenu/.test(read("components/control-room/branch-panel.tsx")), "the strip sits in the branch screen header (its end edge), and 'See more' sets peopleFor");
ok(/if \(open && peopleFor === open\.id\)[\s\S]{0,200}<BranchPeopleScreen branchId=\{open\.id\}/.test(view), "the full screen takes the branch screen's place");
ok(/const openBranch = \(id: string\) => \{[^}]*setPeopleFor\(null\)/.test(view), "opening any branch closes a people screen left open");
ok(/onBack=\{\(\) => \{ setOpenId\(null\); setPeopleFor\(null\)/.test(view), "going back to the list clears it");

console.log("BP5 — display only, admin only");
const comp = read("components/control-room/branch-people.tsx");
ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/.test(comp), "the component sends nothing — only reads");
ok(/\/api\/people/.test(comp) && /\/api\/admin\/users/.test(comp), "reads the two admin APIs the Permissions screen already reads");
ok(/if \(!pr\.ok \|\| !ar\.ok\) return null;/.test(comp) && /if \(d\.state !== "ready"\) return null;/.test(comp), "not an admin (a refusal) → the section is simply not shown");
ok(!/<script|dangerouslySetInnerHTML/.test(comp), "no raw HTML injected (names are plain text)");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
