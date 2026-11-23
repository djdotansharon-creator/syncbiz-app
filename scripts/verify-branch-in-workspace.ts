/**
 * Branch-in-workspace WRITE guard (2026-11-24) — `branchBelongsToWorkspace` (lib/branch-resolver.ts).
 *
 * Why: `hasBranchAccess` answers "yes" to ANY branch id for an owner / admin (the "*" wildcard), so a branch id of ANOTHER
 * business could be saved inside this one (radio creates a stub Branch row for it; a schedule saves a cascading FK to it).
 * The guard is AND-ed after hasBranchAccess at exactly three write sites: POST /api/radio, POST /api/schedules and the
 * `branchId` part of PATCH /api/schedules/[id]. Playlists / sources / move-to-branch are NOT in this change.
 *
 * Proves: the legacy key "default" (and empty), the workspace's canonical branch and a real branch of the workspace ALL still pass
 * (and "default" costs no query), a branch of another business is refused (including that business's canonical branch), no
 * workspace → refused, and the three routes carry the guard in the right place with the same 403 as before.
 * Run: npx tsx scripts/verify-branch-in-workspace.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { branchBelongsToWorkspace, type BranchRowLookup } from "../lib/branch-resolver";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");

const WS = "31d30e23-8f4a-4bf2-a1df-c707b69b5673";
const WS_SLUG = "aroma-cafe";
const CANON = "90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2"; // this business's canonical branch (legacyKey "default")
const REAL = "5b1f0c3e-6a52-4a52-9d3e-1c8f0a7d2b11"; // a second real branch of this business
const OTHER_WS = "aaaaaaaa-0000-4000-8000-000000000000";
const OTHER_CANON = "bbbbbbbb-0000-4000-8000-000000000001"; // ANOTHER business's canonical branch
const OTHER_REAL = "cccccccc-0000-4000-8000-000000000002"; // ANOTHER business's real branch

// an in-memory Branch table; the lookup mirrors the real query: id match AND workspace matched by id OR slug
const rows = [
  { id: CANON, workspaceId: WS, slug: WS_SLUG },
  { id: REAL, workspaceId: WS, slug: WS_SLUG },
  { id: OTHER_CANON, workspaceId: OTHER_WS, slug: "other" },
  { id: OTHER_REAL, workspaceId: OTHER_WS, slug: "other" },
];
let lookups = 0;
const lookup: BranchRowLookup = async (branchId, workspaceKey) => {
  lookups++;
  return rows.some((r) => r.id === branchId && (r.workspaceId === workspaceKey || r.slug === workspaceKey));
};
const ok = (ws: string | null | undefined, b: string | null | undefined) => branchBelongsToWorkspace(ws, b, lookup);

(async () => {
  // ── what a save that works today must keep doing ───────────────────────────────────────────────────────────
  lookups = 0;
  assert("legacy key 'default' passes (single-branch business / desktop / mobile / pilot station)", (await ok(WS, "default")) === true);
  assert("empty / blank / missing branch normalizes to 'default' and passes", (await ok(WS, "")) === true && (await ok(WS, "   ")) === true && (await ok(WS, undefined)) === true && (await ok(WS, null)) === true);
  assert("'default' costs NO query (nothing added to the hot path of a single-branch business)", lookups === 0, `${lookups} lookups`);
  assert("the canonical branch of this business passes (alias of 'default')", (await ok(WS, CANON)) === true);
  assert("a real branch of this business passes", (await ok(WS, REAL)) === true && (await ok(WS, ` ${REAL} `)) === true);
  assert("the workspace may be given as its slug (the stores resolve id OR slug) — still passes", (await ok(WS_SLUG, REAL)) === true && (await ok(WS_SLUG, CANON)) === true);
  assert("the other business's own branches pass for THAT business (the guard is per business, not global)", (await ok(OTHER_WS, OTHER_REAL)) === true && (await ok(OTHER_WS, OTHER_CANON)) === true);

  // ── what is refused ────────────────────────────────────────────────────────────────────────────────────────
  assert("a REAL branch of ANOTHER business is refused", (await ok(WS, OTHER_REAL)) === false);
  assert("another business's CANONICAL branch is refused (the alias never crosses a business)", (await ok(WS, OTHER_CANON)) === false);
  assert("the reverse is refused too", (await ok(OTHER_WS, REAL)) === false && (await ok(OTHER_WS, CANON)) === false);
  assert("an id that is no branch anywhere is refused (no stub Branch row would be created for it)", (await ok(WS, "not-a-branch")) === false && (await ok(WS, "' OR 1=1 --")) === false);
  assert("no workspace → refused (fail closed), even for 'default'", (await ok("", "default")) === false && (await ok(null, REAL)) === false && (await ok(undefined, "default")) === false && (await ok("  ", CANON)) === false);

  // ── the owner wildcard: hasBranchAccess alone says yes to anything; the guard AND-ed after it closes only the foreign case ──
  const ownerHasBranchAccess = async (_b: string) => true; // what hasBranchAccess returns for "*"
  const saveAllowed = async (b: string) => (await ownerHasBranchAccess(b)) && (await ok(WS, b));
  assert("owner: default / canonical / real branch still saved; a foreign branch is not",
    (await saveAllowed("default")) && (await saveAllowed(CANON)) && (await saveAllowed(REAL)) && !(await saveAllowed(OTHER_REAL)) && !(await saveAllowed(OTHER_CANON)));

  // ── static: the guard sits at exactly the three write sites, after the existing access check, same 403 ─────────
  const radio = read("app", "api", "radio", "route.ts");
  const post = radio.slice(radio.indexOf("export async function POST"));
  assert("S1 POST /api/radio: hasBranchAccess stays; the guard follows it and comes before the station is created (same 403 message)",
    /hasBranchAccess\(user\.id, branchId, user\.tenantId\)/.test(post) && /branchBelongsToWorkspace\(user\.tenantId, branchId\)/.test(post) &&
    post.indexOf("hasBranchAccess(") < post.indexOf("branchBelongsToWorkspace(") && post.indexOf("branchBelongsToWorkspace(") < post.indexOf("createRadioStation(") &&
    /branchBelongsToWorkspace\([^\n]*\)\)\) \{\n\s*return NextResponse\.json\(\{ error: "Forbidden: no access to this branch" \}, \{ status: 403 \}\);/.test(post));

  const sched = read("app", "api", "schedules", "route.ts");
  const spost = sched.slice(sched.indexOf("export async function POST"));
  assert("S2 POST /api/schedules: the guard follows hasBranchAccess, uses the SAME workspace the row is saved in (resolveAccountScope), and comes before the target validation and the save",
    /branchBelongsToWorkspace\(resolveAccountScope\(user\.tenantId\), branchId\)/.test(spost) &&
    spost.indexOf("hasBranchAccess(") < spost.indexOf("branchBelongsToWorkspace(") && spost.indexOf("branchBelongsToWorkspace(") < spost.indexOf("validateScheduleTarget(") && spost.indexOf("branchBelongsToWorkspace(") < spost.indexOf("db.addSchedule("));

  const sid = read("app", "api", "schedules", "[id]", "route.ts");
  const patch = sid.slice(sid.indexOf("export async function PATCH"), sid.indexOf("export async function DELETE"));
  const branchBlock = patch.slice(patch.indexOf("if (data.branchId !== undefined) {"), patch.indexOf("const targetType = "));
  assert("S3 PATCH /api/schedules/[id]: the guard runs ONLY when a new branch is sent (inside `if (data.branchId !== undefined)`), after the access check, before the target validation; a PATCH without branchId is untouched",
    /branchBelongsToWorkspace\(resolveAccountScope\(access\.user!\.tenantId\), branchId\)/.test(branchBlock) && branchBlock.indexOf("hasBranchAccess(") < branchBlock.indexOf("branchBelongsToWorkspace(") &&
    patch.indexOf("branchBelongsToWorkspace(") < patch.indexOf("validateScheduleTarget(") && (patch.match(/branchBelongsToWorkspace\(/g) ?? []).length === 1 &&
    /status: 403/.test(branchBlock.slice(branchBlock.indexOf("branchBelongsToWorkspace("))));

  const guarded = ["app/api/radio/route.ts", "app/api/schedules/route.ts", "app/api/schedules/[id]/route.ts"];
  assert("S4 the existing hasBranchAccess checks are still in all three routes (the guard is added, never substituted)", guarded.every((f) => /hasBranchAccess\(/.test(read(...f.split("/")))));

  // ── scope: nothing else changed ────────────────────────────────────────────────────────────────────────────
  const outOfScope = [
    "app/api/playlists/route.ts", "app/api/playlists/ai-build/route.ts", "app/api/playlists/[id]/move-to-branch/route.ts", "app/api/sources/route.ts",
    "app/api/sources/add-from-catalog-track/route.ts", "app/api/schedules/switch/route.ts", "app/api/radio/[id]/route.ts", "app/api/sources/[id]/route.ts",
    "lib/user-store.ts", "lib/auth-helpers.ts", "lib/store.ts", "lib/radio-store.ts", "lib/playlist-store.ts",
    "lib/station-device-store.ts", "lib/station-device-bind.ts", "app/api/admin/branch-master/route.ts", "app/api/devices/register/route.ts", "server/index.ts",
  ];
  assert("S5 scope: playlists / sources / move-to-branch, the stores, hasBranchAccess itself, and every station / MASTER / WS file do NOT use the guard (untouched)",
    outOfScope.every((f) => { try { return !/branchBelongsToWorkspace/.test(read(...f.split("/"))); } catch { return true; } }));
  const resolver = read("lib", "branch-resolver.ts");
  assert("S6 the helper only reads (one findFirst, no write / upsert / delete), asks the database nothing for a legacy key, and does not touch the station or MASTER model",
    /prisma\.branch\.findFirst/.test(resolver.slice(resolver.indexOf("lookupBranchRow"), resolver.indexOf("export async function branchBelongsToWorkspace"))) &&
    !/\.(upsert|create|update|delete)\(/.test(resolver.slice(resolver.indexOf("lookupBranchRow"), resolver.indexOf("const legacyKeyCache"))) &&
    !/stationDevice|BranchMasterDesignation/i.test(resolver.slice(resolver.indexOf("lookupBranchRow"), resolver.indexOf("const legacyKeyCache"))));

  console.log(`\n${pass} passed, ${fail} failed`);
})();
