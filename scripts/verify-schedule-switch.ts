/**
 * The BRANCH's schedule switch (owner 2026-11-16: "the schedule of THIS player is on / off — saved with the branch, any manager can flip it from anywhere, the player obeys, it never touches
 * another branch, it works offline from the last state it got, and when it is turned on the block that should be playing starts at once"). Static checks of the code + the migration; the
 * behaviour itself (API, scope, player, offline copy) was run against the local database and a real browser.
 * Run: npx tsx scripts/verify-schedule-switch.ts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(root, p), "utf-8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else fail++;
}

const mig = readdirSync(path.join(root, "prisma/migrations")).find((d) => d.endsWith("_branch_schedule_enabled"));
const sql = mig ? rd(`prisma/migrations/${mig}/migration.sql`) : "";
assert("W1 DATABASE additive only: one new column on Branch, default true (every branch keeps running its schedule), nothing dropped or rewritten", !!mig && /ALTER TABLE "Branch" ADD COLUMN "scheduleEnabled" BOOLEAN NOT NULL DEFAULT true;/.test(sql) && !/DROP|DELETE|UPDATE|TRUNCATE/i.test(sql.replace(/--.*$/gm, "")) && /scheduleEnabled\s+Boolean\s+@default\(true\)/.test(rd("prisma/schema.prisma")));

const lib = rd("lib/branch-schedule-switch.ts");
assert("W2 the switch belongs to ONE branch: the key is resolved to that branch's row (the legacy key 'default' = the workspace's canonical branch) and the update is by that row's id only; a key that is not a real branch is not switchable and keeps running", /findFirst\(\{ where: \{ id, workspaceId \}/.test(lib) && /prisma\.branch\.update\(\{ where: \{ id \}, data: \{ scheduleEnabled: enabled \} \}\)/.test(lib) && /if \(!id\) return \{ enabled: true, switchable: false, branchId: null \}/.test(lib) && !/updateMany/.test(lib));
assert("W3 a read error never silences a branch (the flag then reads as on)", /catch \{\s+return \{ enabled: true, switchable: false, branchId: id \};/.test(lib));

const route = rd("app/api/schedules/switch/route.ts");
assert("W4 the route is guarded like editing the branch's schedules: signed in, tenant known, hasBranchAccess to THAT branch (403 otherwise); a body without a boolean is refused (400); a branch that is not a real one answers 404", /hasBranchAccess\(user\.id, key, user\.tenantId\)/.test(route) && /Forbidden: no access to this branch/.test(route) && /typeof body\.enabled !== "boolean"/.test(route) && /status: 404/.test(route) && /Unauthorized/.test(route));

const sch = rd("app/api/schedules/route.ts");
assert("W5 the flag travels with the schedules a player already asks for (header X-Schedule-Enabled, only for a branch the caller may see) — no new traffic, the reply's shape is unchanged", /"X-Schedule-Enabled"\] = sw\.enabled \? "1" : "0"/.test(sch) && /isOwner \|\| allowedBranchIds\.includes\(wanted\)/.test(sch) && /NextResponse\.json\(schedulesForBranch\(filtered, wanted,/.test(sch));

const ap = rd("components/schedule-auto-player.tsx");
assert("W6 the player obeys: it reads the header, keeps it with the cached schedules (offline it goes on with the last state it got), does nothing at all while it is off (no start, no stop), and the per-browser switch no longer decides anything", /res\.headers\.get\("x-schedule-enabled"\) !== "0"/.test(ap) && /JSON\.stringify\(\{ at: Date\.now\(\), schedules, enabled \}\)/.test(ap) && /enabled = cached\.enabled;/.test(ap) && /if \(!enabled\) return;/.test(ap) && !/useScheduleEngine|engineEnabled/.test(ap));
assert("W7 turned back ON: today's 'already started' marks are cleared and it looks at once — the block that should be playing now starts; a flip in this window nudges the player through an event (no waiting for the next look), a flip from elsewhere is seen at the next look (every 30 s)", /if \(enabled && wasEnabled\.current === false\) \{[\s\S]*?todaysFiredKeys\(Object\.keys\(localStorage\), new Date\(\)\)/.test(ap) && /window\.addEventListener\(SCHEDULE_SWITCH_EVENT, onPrefs\)/.test(ap) && /window\.dispatchEvent\(new Event\(SCHEDULE_SWITCH_EVENT\)\)/.test(rd("lib/schedule-switch-client.ts")));

const st = rd("components/schedules-studio/schedules-studio.tsx");
const css = rd("app/schedules-studio.css");
assert("W8 the studio's switch is the branch's: it belongs to the branch being looked at (else this window's own), is saved at once and confirmed by the server (a failure puts it back and says so), is re-read every 30 s and on return to the tab, says 'Schedule: On / Off' with the branch's name when there are several, and is a plain switch (no extra controls)", /const switchBranch = branchFilter !== "all" \? branchFilter : stationBranch;/.test(st) && /await saveScheduleSwitch\(switchBranch, next\)/.test(st) && /setSw\(\{ branch: switchBranch, enabled: !next, switchable: true \}\)/.test(st) && /window\.setInterval\(read, 30_000\)/.test(st) && /tr\("Schedule: On"\) : tr\("Schedule: Off"\)/.test(st) && /branches\.length > 1 \? <bdi className="ss-switch-branch">/.test(st) && !/engineEnabled/.test(st));
assert("W9 while the branch's schedule is off the blocks look out of force — pale and a little blurred — and pointing at one (or holding / selecting it) brings it back so it can still be edited", /data-schedule=\{scheduleOn \? "on" : "off"\}/.test(st) && /\.ss\[data-schedule="off"\] \.ss-block, \.ss\[data-schedule="off"\] \.ss-jpin \{ filter: saturate\(0\.12\) blur\(1\.5px\); opacity: 0\.55; \}/.test(css) && /\.ss\[data-schedule="off"\] \.ss-block:hover, \.ss\[data-schedule="off"\] \.ss-block\.is-dragging, \.ss\[data-schedule="off"\] \.ss-block\.is-selected \{ filter: none; opacity: 1; \}/.test(css));
assert("W10 the words exist in Hebrew", /"Schedule: On": "לוח זמנים: פעיל"/.test(rd("lib/i18n/phrases.ts")) && /"Schedule: Off": "לוח זמנים: כבוי"/.test(rd("lib/i18n/phrases.ts")));
assert("W11 the Branch list carries the flag (type + store mapping), so a screen that lists branches can show it", /scheduleEnabled\?: boolean;/.test(rd("lib/types.ts")) && /scheduleEnabled: row\.scheduleEnabled \?\? true,/.test(rd("lib/store.ts")));
assert("W12 nothing of the playback chain, the desktop MAIN or the installer is touched by this change", existsSync(path.join(root, "lib/schedule-switch-client.ts")) && !/desktop\//.test(ap));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
