// "Approve shared playlists": a permission every role can have or not (owner 2026-11-26). Pure rule + wiring of the server check on accepting a BRANCH share.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALL_FLAG_KEYS, EXTRA_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS, defaultPermissionsFor, emptyPermissions, normalizePermissions, roleMayApprovePlaylists } from "../lib/role-permissions";
let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }
const rd = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8").replace(/\r\n/g, "\n");

assert("A1 the switch exists, is drawn on the Roles screen (Library & business group) and has a label", (EXTRA_PERMISSIONS as readonly string[]).includes("approve_playlists") && (ALL_FLAG_KEYS as readonly string[]).includes("approve_playlists") && PERMISSION_GROUPS.find((g) => g.id === "extra")!.keys.includes("approve_playlists") && !!PERMISSION_LABELS.approve_playlists.title);
assert("A2 ready-made roles: Manager may, Shift manager and Employee may not; a role the owner makes himself starts with it OFF", defaultPermissionsFor("Manager").flags.approve_playlists === true && defaultPermissionsFor("Shift manager").flags.approve_playlists === false && defaultPermissionsFor("Employee").flags.approve_playlists === false && emptyPermissions("Cashier").flags.approve_playlists === false);
assert("A3 the switch is stored and read back (a role that was saved with it on keeps it; a role saved before the switch existed reads it off)", normalizePermissions({ flags: { approve_playlists: true } }, "Cashier").flags.approve_playlists === true && normalizePermissions({ flags: { play_pause: true } }, "Cashier").flags.approve_playlists === false);
assert("A4 the pure rule: no role of their own -> may (unchanged); a role with the switch on -> may; with it off -> may not; an old role ({}) follows its name's defaults", roleMayApprovePlaylists(null) === true && roleMayApprovePlaylists({ name: "Cashier", permissions: { flags: { approve_playlists: true } } }) === true && roleMayApprovePlaylists({ name: "Cashier", permissions: { flags: { play_pause: true } } }) === false && roleMayApprovePlaylists({ name: "Manager", permissions: {} }) === true && roleMayApprovePlaylists({ name: "Employee", permissions: {} }) === false);

const store = rd("lib/roles-store.ts");
assert("W1 the store answers 'may' with no database query while roles are off (SYNCBIZ_ROLES), and for a person with no role", /export async function memberMayApprovePlaylists[\s\S]{0,400}if \(!isRolesEnvEnabled\(\)\) return true;[\s\S]{0,300}roleMayApprovePlaylists\(m \? \{ name: m\.role\.name, permissions: m\.role\.permissions \} : null\)/.test(store));
const route = rd("app/api/playlist-shares/[id]/route.ts");
assert("W2 ACCEPTING a share to a BRANCH needs the switch on the server (the business owner is never held back; a share to a PERSON is the person's own answer and is unchanged)", /else if \(branchShare\) \{[\s\S]{0,500}action === "accept" && \(await getAccessType\(user\.id, tenantId\)\) !== "OWNER" && !\(await memberMayApprovePlaylists\(tenantId, user\.id\)\)[\s\S]{0,200}status: 403/.test(route) && /if \(toMe\) \{\s*decision = decideShareAction\(\{ current: share\.status as ShareStatus, action, isSender: false, canUseTarget: true \}\);/.test(route));
const ph = rd("lib/i18n/phrases.ts");
assert("W3 the three new texts have a Hebrew phrase", ["Approve shared playlists", "Accept a playlist that another branch shares with this branch.", "Your role may not approve shared playlists"].every((k) => ph.includes(`"${k}":`)));
assert("W4 the enforcement map of docs/ROLES_DESIGN.md says where it is enforced", /Approve shared playlists \(owner 2026-11-26\) \| yes \| \*\*yes\*\*/.test(rd("docs/ROLES_DESIGN.md")));
console.log(`\n${pass} passed, ${fail} failed`);
