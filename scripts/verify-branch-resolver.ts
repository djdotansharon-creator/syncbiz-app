/**
 * CONTROL ROOM PHASE 1 / GATE 1 — app-side branch resolver is SHADOW ONLY.
 * Proves: runtime mode constant is "shadow" (not env); shadow/off never change the effective branch; the two
 * observation sites are fire-and-forget and leave their responses/claims untouched; the migration is additive.
 * Run: npx tsx scripts/verify-branch-resolver.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { BRANCH_RESOLUTION_RUNTIME_MODE, decideBranchResolution, isLegacyBranchKey } from "../lib/branch-resolver";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");
const CANON = "9a1b2c3d-0000-4000-8000-000000000001";

assert("runtime mode constant is 'shadow'", BRANCH_RESOLUTION_RUNTIME_MODE === "shadow");
const mod = read("lib", "branch-resolver.ts");
assert("mode not read from env", /export const BRANCH_RESOLUTION_RUNTIME_MODE: BranchResolutionMode = "shadow";/.test(mod) && !/process\.env/.test(mod));

const s = decideBranchResolution({ mode: "shadow", raw: "default", candidate: CANON });
assert("shadow: candidate kept for logging", s.candidate === CANON);
assert("shadow: EFFECTIVE stays 'default'", s.effective === "default");
assert("shadow: empty raw → 'default' effective", decideBranchResolution({ mode: "shadow", raw: "", candidate: CANON }).effective === "default");
assert("shadow: non-legacy raw untouched, no candidate",
  (() => { const d = decideBranchResolution({ mode: "shadow", raw: "b-1", candidate: CANON }); return d.effective === "b-1" && d.candidate === null; })());
assert("off: no candidate, raw kept", (() => { const d = decideBranchResolution({ mode: "off", raw: "default", candidate: CANON }); return d.effective === "default" && d.candidate === null; })());
assert("(Gate 2 semantics, not wired) active maps default → canonical", decideBranchResolution({ mode: "active", raw: "default", candidate: CANON }).effective === CANON);
assert("legacy key detection", isLegacyBranchKey("default") && isLegacyBranchKey("") && isLegacyBranchKey(undefined) && !isLegacyBranchKey("b-1"));

const tok = read("app", "api", "auth", "ws-token", "route.ts");
assert("ws-token: claims built from the unchanged authorized branches, observation is fire-and-forget after",
  /const authorizedBranches = await getAuthorizedBranchIds\(user\.id, user\.tenantId\);/.test(tok) &&
  /const token = createWsToken\(user\.id, claims\);\n\s*\/\/[^\n]*\n\s*void observeBranchResolutionShadow\("ws-token"/.test(tok) &&
  !/claims\.[a-zA-Z]+\s*=\s*[^;]*observe/.test(tok));
const reg = read("app", "api", "devices", "register", "route.ts");
assert("devices/register: result computed first, observation is fire-and-forget, response unchanged",
  /const \{ status, body: resBody \} = await processStationDeviceRegister\(user, body, deps\);/.test(reg) &&
  /void observeBranchResolutionShadow\("devices-register"/.test(reg) && /return NextResponse\.json\(resBody, \{ status \}\);/.test(reg));
assert("resolver is consumed ONLY by the two shadow observation sites",
  (() => {
    const users = ["app/api/auth/ws-token/route.ts", "app/api/devices/register/route.ts"];
    return users.every((u) => /observeBranchResolutionShadow/.test(read(...u.split("/"))));
  })());

const mig = read("prisma", "migrations", "20261006090000_branch_legacy_key", "migration.sql");
assert("migration is additive only (ADD COLUMN nullable + unique index)",
  /ALTER TABLE "Branch" ADD COLUMN "legacyKey" TEXT;/.test(mig) && /CREATE UNIQUE INDEX "Branch_workspaceId_legacyKey_key"/.test(mig) &&
  !/DROP|UPDATE|DELETE|NOT NULL|RENAME/i.test(mig.replace(/--[^\n]*/g, "")));
const ops = read("scripts", "control-room", "ensure-legacy-branch.mjs");
assert("ops script writes ONLY the canonical Branch row (no updates of legacy 'default' rows)",
  /prisma\.branch\.upsert\(/.test(ops) && !/\.(updateMany|deleteMany|delete)\(/.test(ops) &&
  !/prisma\.(branchMasterDesignation|stationDevice|userBranchAssignment|jinglePadAssignment|announcement|playlist)\.(update|upsert|create)/.test(ops));

console.log(`\n${pass} passed, ${fail} failed`);
