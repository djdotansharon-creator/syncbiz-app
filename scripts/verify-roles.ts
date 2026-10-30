/**
 * Roles with switches + the owner's access code — the pure rules (lib/roles.ts) and source guards on the door check. No database, no browser. Run: npx tsx scripts/verify-roles.ts
 */
import { readFileSync } from "node:fs";
import * as r from "../lib/roles";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}

assert("P1 roles need the env flag to be 1 or true (unset / 0 / yes are off)", !r.isRolesEnvEnabled({}) && !r.isRolesEnvEnabled({ SYNCBIZ_ROLES: "0" }) && !r.isRolesEnvEnabled({ SYNCBIZ_ROLES: "yes" }) && r.isRolesEnvEnabled({ SYNCBIZ_ROLES: "1" }) && r.isRolesEnvEnabled({ SYNCBIZ_ROLES: "true" }));
assert("P2 a business starts with three ready-made roles: Manager (opens the Control Room), Shift manager, Employee — NONE may use a computer by default (owner 2026-10-31: the switch is off until the owner turns it on for a role)", r.DEFAULT_ROLES.length === 3 && r.DEFAULT_ROLES[0].name === "Manager" && r.DEFAULT_ROLES[0].openControlRoom && !r.DEFAULT_ROLES[1].openControlRoom && !r.DEFAULT_ROLES[2].openControlRoom && r.DEFAULT_ROLES.every((x) => x.allowComputer === false));
assert("P3 a role needs a name (spaces tidied, 40 characters at most); the switches default to: Control Room off, computer on", (() => {
  const a = r.validateRoleInput({ name: "  Night   cashier ", openControlRoom: undefined, allowComputer: undefined });
  const b = r.validateRoleInput({ name: "   ", openControlRoom: true, allowComputer: true });
  const c = r.validateRoleInput({ name: "x".repeat(41), openControlRoom: true, allowComputer: true });
  return a.ok && a.value.name === "Night cashier" && !a.value.openControlRoom && a.value.allowComputer && !b.ok && b.error === "name" && !c.ok && c.error === "name_long";
})());
assert("P4 the Control Room switch decides the platform role (the pages that already check it)", r.tenantRoleForRole({ openControlRoom: true }) === "TENANT_ADMIN" && r.tenantRoleForRole({ openControlRoom: false }) === "TENANT_MEMBER");
const off = { allowComputer: false };
const on = { allowComputer: true };
const pc = { phone: false, desktopApp: false };
assert("P5 a computer is turned away ONLY for a person with a role whose computer switch is off", r.blocksComputer(off, pc) && !r.blocksComputer(on, pc) && !r.blocksComputer(null, pc) && !r.blocksComputer(undefined, pc));
assert("P6 a phone and the desktop app are never turned away, whatever the switch", !r.blocksComputer(off, { phone: true, desktopApp: false }) && !r.blocksComputer(off, { phone: false, desktopApp: true }));
assert("P7 an access code is 3–12 letters or digits", r.validateAccessCode("123").ok && r.validateAccessCode("Shop2026").ok && !r.validateAccessCode("12").ok && !r.validateAccessCode("1234567890123").ok && !r.validateAccessCode("12 3").ok && !r.validateAccessCode("12-3").ok && !r.validateAccessCode(null).ok && !r.validateAccessCode(123).ok);
const h = r.hashAccessCode("4821");
assert("P8 the code is stored salted + hashed (never the code), matches only itself, and two hashes of one code differ", /^[0-9a-f]{64}$/.test(h.hash) && !h.hash.includes("4821") && r.accessCodeMatches("4821", h.salt, h.hash) && r.accessCodeMatches(" 4821 ", h.salt, h.hash) && !r.accessCodeMatches("4822", h.salt, h.hash) && r.hashAccessCode("4821").hash !== h.hash);

const read = (p: string) => readFileSync(p, "utf8");
const layout = read("app/(app)/layout.tsx");
assert("P9 the door check is dormant by default, skips phones and the desktop app, and any failure lets the person in", /if \(user && isRolesEnvEnabled\(\)\)/.test(layout) && /!isPhoneUa\(ua\) && !isDesktopShellUserAgent\(ua\)/.test(layout) && /letting the person in/.test(layout) && /if \(computerBlocked\) return <ComputerBlocked \/>/.test(layout));
const unlock = read("app/api/auth/management-unlock/route.ts");
assert("P10 the owner's own code replaces 123 only when he chose one (and the flag is on); a failing read falls back to the default", /isRolesEnvEnabled\(\)/.test(unlock) && /ownerCode === null \? matchesManagementCode\(entered\) : ownerCode/.test(unlock) && /using the default code/.test(unlock));
for (const f of ["app/api/roles/route.ts", "app/api/roles/[id]/route.ts", "app/api/roles/access-code/route.ts"]) {
  const t = read(f);
  assert(`P11 ${f}: flag first (404 / enabled:false before any database call), then workspace-admin only`, t.indexOf("isRolesEnvEnabled()") !== -1 && t.indexOf("isRolesEnvEnabled()") < t.indexOf("requireWorkspaceAdmin()"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
