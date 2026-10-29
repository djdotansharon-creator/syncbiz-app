/**
 * The access CODE for settings and management on the player computer (owner 2026-10-29: 123 until he chooses his own) — the pure rules (lib/management-code.ts) and source-text guards on where it is used.
 * No browser, no database. Run: npx tsx scripts/verify-management-code.ts
 */
import { readFileSync } from "node:fs";
import { DEFAULT_MANAGEMENT_CODE, managementCode, matchesManagementCode } from "../lib/management-code";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}
const read = (p: string) => readFileSync(p, "utf8");

assert("M1 the code is 123 until a deployment sets its own", DEFAULT_MANAGEMENT_CODE === "123" && managementCode({}) === "123" && managementCode({ SYNCBIZ_MANAGEMENT_CODE: "" }) === "123");
assert("M2 an own code of 3+ characters replaces it; a too-short one is ignored", managementCode({ SYNCBIZ_MANAGEMENT_CODE: "4821" }) === "4821" && managementCode({ SYNCBIZ_MANAGEMENT_CODE: "12" }) === "123" && managementCode({ SYNCBIZ_MANAGEMENT_CODE: "  9090 " }) === "9090");
assert("M3 123 matches (spaces around it do not matter); anything else does not", matchesManagementCode("123", {}) && matchesManagementCode(" 123 ", {}) && !matchesManagementCode("1234", {}) && !matchesManagementCode("12", {}) && !matchesManagementCode("", {}) && !matchesManagementCode("abc", {}));
assert("M4 with an own code set, 123 no longer matches", matchesManagementCode("4821", { SYNCBIZ_MANAGEMENT_CODE: "4821" }) && !matchesManagementCode("123", { SYNCBIZ_MANAGEMENT_CODE: "4821" }));

const route = read("app/api/auth/management-unlock/route.ts");
assert("M5 the unlock route takes the code from ANY signed-in person (role still decides what they see), or a manager's own password, behind the same rate limiter", /matchesManagementCode\(entered\) \|\| \(a\.canManage && \(await validateCredentialsAsync\(a\.email, entered\)\)\)/.test(route) && /attemptKeys\("mgmt-unlock"/.test(route) && /recordFailure/.test(route) && !/Only a manager can unlock/.test(route));
const gate = read("components/management/management-gate.tsx");
assert("M6 Settings is gated only by the station lock (desktop app) — a browser goes straight in, and it is NOT manager-only", /export async function SettingsGate/.test(gate) && /if \(!s\.unlocked\) return <ManagementLockScreen \/>/.test(gate) && !/canManage/.test(gate.slice(gate.indexOf("export async function SettingsGate"))));
const settings = read("app/(app)/settings/page.tsx");
assert("M7 the settings page is wrapped in that gate", /<SettingsGate from="\/settings">\s*<SettingsContent \/>/.test(settings));
const access = read("lib/management-access.ts");
assert("M8 a browser is never locked: the station lock state is unlocked unless the user agent is the desktop app", /if \(!desktop\) return \{ signedIn: true, desktop: false, unlocked: true \}/.test(access));
const lock = read("components/management/management-lock.tsx");
assert("M9 the lock screen asks for a CODE and sends it as `code`", /body: JSON\.stringify\(\{ code: password \}\)/.test(lock) && /tr\("Enter the access code"\)/.test(lock));
const bar = read("components/control-screen/control-bar.tsx");
assert("M10 a person who is not a manager is offered only Settings on the control screen (the manager pages would bounce them)", /canManage \? all : all\.filter\(\(it\) => it\.href === "\/settings"\)/.test(bar));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
