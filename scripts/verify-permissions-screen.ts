/**
 * The Discord-style Permissions screen (owner 2026-10-31) — static checks, no browser. Run: node --env-file=.env.development --require ./scripts/_test-stubs/preload.cjs --import tsx scripts/verify-permissions-screen.ts
 */
import { readFileSync, readdirSync } from "node:fs";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}
const read = (p: string) => readFileSync(p, "utf8");
const page = read("app/(app)/access-control/page.tsx");
const hub = read("components/roles/permissions-hub.tsx");
const rolesHub = read("components/roles/roles-hub.tsx");
const person = read("components/roles/person-page.tsx");
const grid = read("components/roles/people-grid.tsx");
const css = read("components/roles/permissions-hub.css");
const store = read("lib/roles-store.ts");
const mig = readdirSync("prisma/migrations").filter((d) => d.endsWith("_role_permissions"));

assert("S1 the page is the hub (People | Roles tabs) — the old roles table is gone and the old console sits under 'Advanced'", /<PermissionsHub \/>/.test(page) && !/RolesPanel/.test(page) && /<details className="sb-ph-old">/.test(page) && /role="tablist"/.test(hub) && /tr\("People"\)/.test(hub) && /tr\("Roles"\)/.test(hub));
assert("S2 the Roles tab is a list of roles with the chosen role's editor beside it; EVERY permission of the catalog is drawn as a switch (groups from PERMISSION_GROUPS), 'More settings' opens the rest, with the players / people scopes first", /PERMISSION_GROUPS\.map/.test(rolesHub) && /PERMISSION_LABELS\[k\]/.test(rolesHub) && /role\.permissions\.flags\.more_settings/.test(rolesHub) && /ScopeRow title=\{tr\("Players they can see and control"\)\}/.test(rolesHub) && /ScopeRow title=\{tr\("People they can see"\)\}/.test(rolesHub) && /role="switch"/.test(read("components/roles/toggle.tsx")));
assert("S3 a role can be made, renamed and deleted from the screen, and the owner's access code for Settings is kept (left column)", /method: "POST"/.test(rolesHub) && /method: "DELETE"/.test(rolesHub) && /\/api\/roles\/access-code/.test(rolesHub) && /onBlur=/.test(rolesHub));
assert("S4 every change is built on the LATEST version of the role and sent IN ORDER (two quick presses never overwrite each other), and a failure puts the server's version back", /const chain = useRef<Promise<void>>\(Promise\.resolve\(\)\)/.test(rolesHub) && /chain\.current = chain\.current\.then/.test(rolesHub) && /rolesRef\.current/.test(rolesHub) && /await reload\(\)/.test(rolesHub));
assert("S5 a person opens a FULL page (not a window): way-back arrow beside the name, details, role (with what it allows and whether it may open a branch's settings), branches, account; written through the existing admin routes", /onOpenPerson \? onOpenPerson\(p\.userId\)/.test(grid) && /sb-psn-back/.test(person) && /\/api\/people\/\$\{userId\}\/role/.test(person) && /\/api\/admin\/users/.test(person) && /branch_settings/.test(person) && /pause-member/.test(person) && /remove-member/.test(person));
assert("S6 the person page never changes the owner / managers by role and never lets a person change their own role (the server refuses too)", /isAdminLevel/.test(person) && /person\.isYou/.test(person) && /not_yourself/.test(person));
assert("S7 the screen's class names do not collide with the player's (the person page is .sb-psn, not .sb-pp which is the play/pause icon)", !/\bsb-pp\b|sb-pp-/.test(person) && !/\.sb-pp\b|\.sb-pp-/.test(css) && /sb-psn/.test(css));
assert("S8 the store reads and writes the permission list, normalised, and refuses a non-object", /normalizePermissions\(r\.permissions, r\.name\)/.test(store) && /permissions: defaultPermissionsFor\(r\.name\)/.test(store) && /RoleError\("permissions", 400\)/.test(store));
const sql = mig.length === 1 ? read(`prisma/migrations/${mig[0]}/migration.sql`) : "";
assert("S9 the migration is ONE additive column with a default (nothing else changes) — apply it before deploying the code", mig.length === 1 && /ALTER TABLE "WorkspaceRole" ADD COLUMN "permissions" JSONB NOT NULL DEFAULT '\{\}'/.test(sql) && (sql.match(/ALTER TABLE/g) ?? []).length === 1 && !/DROP|DELETE|UPDATE/i.test(sql.replace(/--.*$/gm, "")));
assert("S10 the enforcement map is written down honestly (what is NOT enforced yet is said so)", /Enforcement map/.test(read("docs/ROLES_DESIGN.md")) && /NOT YET/.test(read("docs/ROLES_DESIGN.md")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
