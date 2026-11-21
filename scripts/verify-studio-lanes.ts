/**
 * THE STUDIO SHOWS THIS COMPUTER'S BRANCH ONLY (owner 2026-11-22). Field test 2026-11-21: on the Lenovo (branch Lenovo-Pailot) the Studio drew every branch's blocks — a "Default" row of blocks that
 * do not run on the Lenovo — and a block made from a playlist of another branch took that branch. Owner: "the schedule is the computer's own: one column per day, no Default; managing a whole
 * network belongs in the Control Room". The Studio now loads exactly what THIS window's branch runs (the engine's own rule) and stamps new blocks with this branch; `?branches=all` brings the
 * old view back. Pure helpers (lib/schedules-lanes.ts) + the Studio's and the page's wiring.
 * Run: npx tsx scripts/verify-studio-lanes.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { blockBranchFor, studioItems } from "../lib/schedules-lanes";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");
const LENOVO = "70227520-x", CANON = "canon-default", OTHER = "b-2";
const b = (id: string, branchId?: string | null) => ({ id, branchId });
const all = [b("1", "default"), b("2", "default"), b("3", LENOVO), b("4", OTHER), b("5", CANON), b("6", "orphan-zzz"), b("7")];
const ids = (r: { items: { id: string }[] }) => r.items.map((x) => x.id).join(",");
const known = [LENOVO, CANON, OTHER];

assert("Q1 the Lenovo's window shows ONLY the Lenovo's own blocks (and orphans, as the engine does) — the 'default' and other-branch blocks are not drawn", ids(studioItems({ all, ownBranch: LENOVO, canonicalDefaultBranchId: CANON, knownBranchIds: known, showAllBranches: false })) === "3,6", ids(studioItems({ all, ownBranch: LENOVO, canonicalDefaultBranchId: CANON, knownBranchIds: known, showAllBranches: false })));
assert("Q2 a window on the legacy 'default' branch (a browser with no choice) sees the 'default' blocks AND the canonical branch's — they are the same branch — and not the Lenovo's", ids(studioItems({ all, ownBranch: "default", canonicalDefaultBranchId: CANON, knownBranchIds: known, showAllBranches: false })) === "1,2,5,6,7", ids(studioItems({ all, ownBranch: "default", canonicalDefaultBranchId: CANON, knownBranchIds: known, showAllBranches: false })));
assert("Q3 a business with no canonical branch: 'default' is simply 'default' (the single-branch pilot sees everything it had)", ids(studioItems({ all: [b("1", "default"), b("2"), b("3", "default")], ownBranch: "default", canonicalDefaultBranchId: null, knownBranchIds: [], showAllBranches: false })) === "1,2,3");
assert("Q4 the desktop has not said which branch this computer is: nothing is drawn (never another branch's blocks), and it is still the scoped view", JSON.stringify(studioItems({ all, ownBranch: null, canonicalDefaultBranchId: CANON, knownBranchIds: known, showAllBranches: false })) === JSON.stringify({ items: [], scoped: true }));
const showAll = studioItems({ all, ownBranch: LENOVO, canonicalDefaultBranchId: CANON, knownBranchIds: known, showAllBranches: true });
assert("Q5 ?branches=all brings back the old view: every block, not scoped", showAll.items.length === all.length && !showAll.scoped);

assert("Q6 a PLAYLIST is stamped with the row it was dropped on, else THIS computer's branch (not the playlist's own)", blockBranchFor({ targetType: "PLAYLIST", laneBranch: "r", scopeBranch: LENOVO, itemBranch: "default", quietBranch: "q" }) === "r" && blockBranchFor({ targetType: "PLAYLIST", scopeBranch: LENOVO, itemBranch: "default", quietBranch: "q" }) === LENOVO && blockBranchFor({ targetType: "PLAYLIST", itemBranch: "default", quietBranch: "q" }) === "default");
assert("Q7 a quiet / bank block: its row, else this computer's branch, else the quiet branch (unchanged when not scoped)", blockBranchFor({ targetType: "SILENCE", scopeBranch: LENOVO, itemBranch: "", quietBranch: "q" }) === LENOVO && blockBranchFor({ targetType: "BANK", laneBranch: "r", scopeBranch: LENOVO, itemBranch: "", quietBranch: "q" }) === "r" && blockBranchFor({ targetType: "SILENCE", itemBranch: "", quietBranch: "q" }) === "q");
assert("Q8 a song / a radio station: this computer's branch when scoped (the server refuses another branch's and says so, instead of a block that silently never runs here); all-branches view: its own, as before", blockBranchFor({ targetType: "RADIO", laneBranch: "r", scopeBranch: LENOVO, itemBranch: "x", quietBranch: "q" }) === LENOVO && blockBranchFor({ targetType: "SOURCE", laneBranch: "r", itemBranch: "x", quietBranch: "q" }) === "x");

const studio = rd("components/schedules-studio/schedules-studio.tsx");
const code = studio.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
assert("Q9 the Studio loads through studioItems (state AND every refresh of the list), with this window's branch, the business's canonical default and the known branches", /const ownBranchRaw = useStationBranchId\(\)/.test(code) && /studioItems\(\{ all, ownBranch: ownBranchRaw, canonicalDefaultBranchId: defaultBranchId, knownBranchIds: branches\.map\(\(b\) => b\.id\), showAllBranches \}\)/.test(code) && /useState<Schedule\[\]>\(\(\) => scopeOf\(initialSchedules\)\.items\)/.test(code) && /setItems\(scopeOf\(initialSchedules\)\.items\)/.test(code));
assert("Q10 ?branches=all is read from the address after the page is up (no hydration mismatch)", /new URLSearchParams\(window\.location\.search\)\.get\("branches"\) === "all"/.test(code) && /useEffect\(\(\) => \{\s*try \{ setShowAllBranches/.test(code));
assert("Q11 the extra 'own branch' row of the first attempt is GONE: the rows and the branch filter come from the branches that have blocks, as originally", !/laneIds|laneBranchIds/.test(code) && /branchIds\.length > 0 \? branchIds : \[branches\[0\]\?\.id \?\? "default"\]/.test(code) && /\{branchIds\.length > 1 \? \(/.test(code));
assert("Q12 the quiet branch and the business hours are this computer's own when scoped; the all-branches view is as before", /scoped && ownBranchRaw \? ownBranchRaw : branchIds\[0\]/.test(code) && /if \(scoped && ownBranchRaw\) return \[\{ id: ownBranchRaw, name: branchName\(ownBranchRaw\) \}\]/.test(code));
assert("Q13 a new block is stamped through blockBranchFor with this computer's branch as the scope", /branchId: blockBranchFor\(\{ targetType: item\.targetType, laneBranch: branchId, scopeBranch: scoped && ownBranchRaw \? ownBranchRaw : undefined,/.test(code));
const page = rd("app/(app)/(workspace)/schedules/page.tsx");
assert("Q14 the schedules page gives the Studio the business's canonical default branch (null when none, never throws)", /getCanonicalLegacyBranchId\(user\.tenantId\)/.test(page) && /defaultBranchId=\{defaultBranchId\}/.test(page) && /catch \{\s*defaultBranchId = null;/.test(page));
assert("Q15 the pure helpers import only the engine's own branch-scope rule (no playback, no store)", rd("lib/schedules-lanes.ts").split("\n").filter((l) => /^import /.test(l)).join("") === 'import { schedulesForBranch } from "./schedule-branch-scope";');
console.log(`\n${pass} passed, ${fail} failed`);
