/**
 * Phase 0.2A regression — StationDevice cloud registration.
 *
 * Tests the PURE core (validator + race-safe algorithm via an in-memory repo) and the route decision
 * (processStationDeviceRegister via injected fake deps) with no database. Plus static guards that the change is
 * additive and does not touch Device/Branch serialization, server/index.ts, or MASTER behavior.
 *
 * Run: npx tsx scripts/verify-station-device-register.ts
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import {
  isValidDurableDeviceId,
  registerStationDevice,
  DurableDeviceConflictError,
  type StationDeviceRepo,
  type RegisterStationDeviceInput,
  type RegisterResult,
} from "@/lib/station-device-store";
import { processStationDeviceRegister, type RegisterDeps } from "@/lib/station-device-register";

// Test secret MUST be set before minting/verifying tokens (getSecret reads env at call time).
process.env.SYNCBIZ_WS_SECRET = "test-ws-secret-0123456789";
import { createWsToken, createDesktopAccessToken, verifyDesktopAccessToken, verifyDesktopAccessTokenClaims } from "@/lib/auth-ws-token";
import { enforceTokenWorkspaceScope } from "@/lib/desktop-token-scope";
import type { User } from "@/lib/user-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const repoRoot = path.join(__dirname, "..");

async function main(): Promise<void> {

// ── In-memory repo modeling the durableDeviceId unique constraint (atomic has→set, no await between) ─────────
function makeFakeRepo(createDelayMs = 0) {
  const rows = new Map<string, { workspaceId: string; branchId: string; platform: string; appVersion: string }>();
  const repo: StationDeviceRepo = {
    async create(input) {
      if (createDelayMs) await delay(createDelayMs); // widen the TOCTOU window BEFORE the atomic check
      if (rows.has(input.durableDeviceId)) throw new DurableDeviceConflictError();
      rows.set(input.durableDeviceId, {
        workspaceId: input.workspaceId, branchId: input.branchId,
        platform: input.platform, appVersion: input.appVersion,
      });
    },
    async findByDurableId(id) {
      const r = rows.get(id);
      return r ? { workspaceId: r.workspaceId, branchId: r.branchId } : null;
    },
    async refresh(id, match, patch) {
      const r = rows.get(id);
      if (r && r.workspaceId === match.workspaceId && r.branchId === match.branchId) {
        r.platform = patch.platform; r.appVersion = patch.appVersion;
      }
    },
  };
  return { repo, rows };
}
const inp = (over: Partial<RegisterStationDeviceInput>): RegisterStationDeviceInput => ({
  durableDeviceId: "device-abc-0001", workspaceId: "ws-A", branchId: "default",
  platform: "windows", appVersion: "2.2.8", ...over,
});

// ── 1. Validator (Phase 0.1 contract) ───────────────────────────────────────────────────────────────────────
assert("validator: legacy id WITHOUT dsk- prefix accepted", isValidDurableDeviceId("legacy-device-01"));
assert("validator: dsk- id accepted", isValidDurableDeviceId("dsk-1c1e5b1a-0000-4000-8000-000000000000"));
assert("validator: exactly 8 chars accepted", isValidDurableDeviceId("abcdefgh"));
assert("validator: too short (<8) rejected", !isValidDurableDeviceId("abc"));
assert("validator: >200 chars rejected", !isValidDurableDeviceId("x".repeat(201)));
assert("validator: control char rejected", !isValidDurableDeviceId("abcdef\u0001gh"));
assert("validator: non-string rejected", !isValidDurableDeviceId(12345678 as unknown));
assert("validator: outer whitespace trimmed then validated", isValidDurableDeviceId("   legacy-01   "));
assert("validator: whitespace-only rejected", !isValidDurableDeviceId("          "));

// ── 2. Registration algorithm ────────────────────────────────────────────────────────────────────────────────
{
  const { repo, rows } = makeFakeRepo();
  const r1 = await registerStationDevice(repo, inp({}));
  assert("first registration → created", r1.outcome === "created" && rows.size === 1);

  const r2 = await registerStationDevice(repo, inp({ platform: "win11", appVersion: "2.2.9" }));
  assert("same ws+branch → refreshed", r2.outcome === "refreshed");
  const row = rows.get("device-abc-0001")!;
  assert("refresh updated platform/appVersion, identity unchanged",
    row.platform === "win11" && row.appVersion === "2.2.9" && row.workspaceId === "ws-A" && row.branchId === "default");

  const r3 = await registerStationDevice(repo, inp({ branchId: "branch-2" }));
  assert("same ws, different branch → branch_conflict (NO mutation)",
    r3.outcome === "branch_conflict" && rows.get("device-abc-0001")!.branchId === "default");

  const r4 = await registerStationDevice(repo, inp({ workspaceId: "ws-B" }));
  assert("different workspace → workspace_conflict (NO mutation)",
    r4.outcome === "workspace_conflict" && rows.get("device-abc-0001")!.workspaceId === "ws-A");
}

// ── 2b. Concurrency — same durable id can never create/rebind two rows ────────────────────────────────────────
{
  const { repo, rows } = makeFakeRepo(5); // force interleaving
  const [a, b] = await Promise.all([
    registerStationDevice(repo, inp({})),
    registerStationDevice(repo, inp({ platform: "win11" })),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert("concurrent same ws/branch → exactly ONE row", rows.size === 1);
  assert("concurrent same ws/branch → one created + one refreshed", JSON.stringify(outcomes) === JSON.stringify(["created", "refreshed"]), outcomes.join("+"));
}
{
  const { repo, rows } = makeFakeRepo(5);
  const [a, b] = await Promise.all([
    registerStationDevice(repo, inp({ workspaceId: "ws-A" })),
    registerStationDevice(repo, inp({ workspaceId: "ws-B" })),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert("concurrent different workspace → exactly ONE row (no rebind/hijack)", rows.size === 1);
  assert("concurrent different workspace → one created + one workspace_conflict",
    JSON.stringify(outcomes) === JSON.stringify(["created", "workspace_conflict"]), outcomes.join("+"));
}

// ── 3. Route decision (processStationDeviceRegister) with injected deps ───────────────────────────────────────
const USER = { id: "u1", tenantId: "ws-real" };
function fakeDeps(authorized: string[], outcome: RegisterResult["outcome"]) {
  const calls = { authorized: 0, register: [] as RegisterStationDeviceInput[] };
  const deps: RegisterDeps = {
    getAuthorizedBranches: async () => { calls.authorized++; return authorized; },
    register: async (i) => { calls.register.push(i); return { outcome }; },
  };
  return { deps, calls };
}
const body = (over: Record<string, unknown> = {}) => ({ durableDeviceId: "device-abc-0001", branchId: "default", platform: "windows", appVersion: "2.2.8", ...over });

{
  const { deps, calls } = fakeDeps(["default"], "created");
  const res = await processStationDeviceRegister(null, body(), deps);
  assert("no user → 401, zero writes", res.status === 401 && calls.register.length === 0 && calls.authorized === 0);
}
{
  const { deps, calls } = fakeDeps(["default"], "created");
  const res = await processStationDeviceRegister(USER, body({ durableDeviceId: "short" }), deps);
  assert("invalid durableId → 400, zero writes/authz", res.status === 400 && calls.register.length === 0 && calls.authorized === 0);
}
{
  const { deps, calls } = fakeDeps(["default"], "created");
  const res = await processStationDeviceRegister(USER, body({ branchId: "branch-x" }), deps);
  assert("unauthorized branch → 403, zero writes", res.status === 403 && calls.register.length === 0);
}
{
  const { deps } = fakeDeps(["default"], "created");
  const res = await processStationDeviceRegister(USER, body(), deps);
  assert("valid first registration → 201", res.status === 201);
}
{
  const { deps } = fakeDeps(["default"], "refreshed");
  const res = await processStationDeviceRegister(USER, body(), deps);
  assert("idempotent same ws/branch → 200", res.status === 200);
}
{
  const { deps } = fakeDeps(["default"], "branch_conflict");
  const res = await processStationDeviceRegister(USER, body(), deps);
  assert("different branch → 409", res.status === 409);
}
{
  const { deps } = fakeDeps(["default"], "workspace_conflict");
  const res = await processStationDeviceRegister(USER, body(), deps);
  assert("different workspace → 409 (no workspace leak)",
    res.status === 409 && !JSON.stringify(res.body).includes("ws-"));
}
{
  // body.workspaceId must be IGNORED — register receives the user's tenantId.
  const { deps, calls } = fakeDeps(["default"], "created");
  await processStationDeviceRegister(USER, body({ workspaceId: "evil-ws" }), deps);
  assert("body.workspaceId is ignored — register uses user.tenantId",
    calls.register[0]?.workspaceId === "ws-real", calls.register[0]?.workspaceId);
}
{
  // missing branchId defaults to "default" when authorized.
  const { deps, calls } = fakeDeps(["default"], "created");
  const res = await processStationDeviceRegister(USER, body({ branchId: undefined }), deps);
  assert("missing branchId defaults to 'default'", res.status === 201 && calls.register[0]?.branchId === "default");
}

// ── 3b. GAP 1 — desktop_access-ONLY auth (verifyDesktopAccessToken) ───────────────────────────────────────────
{
  const secret = process.env.SYNCBIZ_WS_SECRET!;
  const now = Math.floor(Date.now() / 1000);
  const craft = (payload: Record<string, unknown>) => {
    const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
    const sig = createHmac("sha256", secret).update(b64).digest("base64url");
    return `${b64}.${sig}`;
  };

  const validDesktop = createDesktopAccessToken("u-desktop", { workspaceId: "ws-A", authorizedBranches: ["default"] });
  assert("valid desktop_access token → userId", verifyDesktopAccessToken(validDesktop) === "u-desktop");

  const wsRegister = createWsToken("u-desktop", { workspaceId: "ws-A", authorizedBranches: ["default"] });
  assert("ws_register token → null (rejected)", verifyDesktopAccessToken(wsRegister) === null);

  const expired = craft({ purpose: "desktop_access", userId: "u-desktop", iat: now - 100000, exp: now - 10 });
  assert("expired desktop_access token → null", verifyDesktopAccessToken(expired) === null);

  const tampered = validDesktop.slice(0, -2) + (validDesktop.endsWith("aa") ? "bb" : "aa");
  assert("tampered signature → null", verifyDesktopAccessToken(tampered) === null);

  assert("empty token → null", verifyDesktopAccessToken("") === null);
  assert("garbage token → null", verifyDesktopAccessToken("not.a.token.at.all") === null);
  // A cookie-issued session is NOT a bearer token at all → the route's getDesktopUserFromApiRequest never
  // reaches a verifier for it (asserted structurally below).

  // Claims verifier carries the signed workspace scope.
  const claimsA = verifyDesktopAccessTokenClaims(validDesktop);
  assert("desktop_access claims → { userId, workspaceId=A }", claimsA?.userId === "u-desktop" && claimsA?.workspaceId === "ws-A");
  const noWs = createDesktopAccessToken("u-desktop"); // minted WITHOUT a workspace claim
  assert("desktop_access without workspaceId claim → workspaceId null", verifyDesktopAccessTokenClaims(noWs)?.workspaceId === null);
  assert("ws_register → claims null", verifyDesktopAccessTokenClaims(wsRegister) === null);
}

// ── 3c. GAP (scope drift) — token workspace is authoritative; no silent fallback to primary/other ──────────────
{
  const mkUser = (tenantId: string): User => ({ id: "u1", email: "u@x", tenantId, createdAt: "" });
  assert("token A + user resolved in A → accepted (scoped to A)",
    enforceTokenWorkspaceScope({ workspaceId: "ws-A" }, mkUser("ws-A"))?.tenantId === "ws-A");
  assert("multi-workspace user cannot drift: token A but resolved B → rejected",
    enforceTokenWorkspaceScope({ workspaceId: "ws-A" }, mkUser("ws-B")) === null);
  assert("token workspace not accessible (fallback to primary ≠ A) → rejected",
    enforceTokenWorkspaceScope({ workspaceId: "ws-A" }, mkUser("ws-primary")) === null);
  assert("missing workspaceId claim → rejected", enforceTokenWorkspaceScope({ workspaceId: null }, mkUser("ws-A")) === null);
  assert("null user → rejected", enforceTokenWorkspaceScope({ workspaceId: "ws-A" }, null) === null);
  assert("null claims → rejected", enforceTokenWorkspaceScope(null, mkUser("ws-A")) === null);
}

// ── 4. Static guards ─────────────────────────────────────────────────────────────────────────────────────────
{
  const mig = readFileSync(path.join(repoRoot, "prisma/migrations/20260929120000_add_station_device_registry/migration.sql"), "utf-8");
  assert("migration creates StationDevice table", /CREATE TABLE "StationDevice"/.test(mig));
  assert("migration adds unique index on durableDeviceId", /CREATE UNIQUE INDEX "StationDevice_durableDeviceId_key"/.test(mig));
  assert("migration does NOT alter Branch/Device", !/ALTER TABLE "(Branch|Device)"/i.test(mig));
  assert("migration has no data backfill (no UPDATE/INSERT/DELETE)", !/\b(UPDATE|INSERT|DELETE)\b/i.test(mig));
}
{
  const server = readFileSync(path.join(repoRoot, "server/index.ts"), "utf-8");
  assert("server/index.ts imports no Prisma (MASTER election untouched)",
    !/@prisma\/client|["']\.{0,2}\/?lib\/prisma|PrismaClient/.test(server));
}
{
  const store = readFileSync(path.join(repoRoot, "lib/store.ts"), "utf-8");
  const rowToBranch = store.slice(store.indexOf("function rowToBranch"), store.indexOf("function rowToDevice"));
  const rowToDevice = store.slice(store.indexOf("function rowToDevice"), store.indexOf("function rowToDevice") + 900);
  assert("rowToBranch unchanged (no StationDevice/durable/designatedMaster)",
    !/StationDevice|durableDeviceId|designatedMaster/i.test(rowToBranch));
  assert("rowToDevice unchanged (no StationDevice/durable)",
    !/StationDevice|durableDeviceId/i.test(rowToDevice));
}
{
  // GAP 1 — the route must use the desktop-only resolver, not the cookie-accepting one.
  const route = readFileSync(path.join(repoRoot, "app/api/devices/register/route.ts"), "utf-8");
  assert("route uses getDesktopUserFromApiRequest (bearer desktop_access only)", /getDesktopUserFromApiRequest/.test(route));
  assert("route does NOT use getCurrentUserFromApiRequest (no cookie/ws_register)", !/getCurrentUserFromApiRequest/.test(route));

  const helpers = readFileSync(path.join(repoRoot, "lib/auth-helpers.ts"), "utf-8");
  const fnStart = helpers.indexOf("export async function getDesktopUserFromApiRequest");
  const fnBody = helpers.slice(fnStart, helpers.indexOf("\n}", fnStart) + 2);
  assert("getDesktopUserFromApiRequest verifies desktop_access CLAIMS", /verifyDesktopAccessTokenClaims/.test(fnBody));
  assert("getDesktopUserFromApiRequest scopes getUserById to the token workspace", /getUserById\([^)]*activeWorkspaceId/.test(fnBody));
  assert("getDesktopUserFromApiRequest hard-gates scope (no drift)", /enforceTokenWorkspaceScope/.test(fnBody));
  assert("getDesktopUserFromApiRequest has NO cookie fallback", !/getCurrentUserFromCookies|cookies\(/.test(fnBody));
}
{
  const schema = readFileSync(path.join(repoRoot, "prisma/schema.prisma"), "utf-8");
  const branchModel = schema.slice(schema.indexOf("model Branch {"), schema.indexOf("model Device {"));
  // End the Device slice at the StationDevice DOC COMMENT (which legitimately mentions durableDeviceId), so the
  // guard checks only the Device model body itself.
  const deviceModel = schema.slice(schema.indexOf("model Device {"), schema.indexOf("/// Phase 0.2A"));
  assert("Branch model has no designatedMasterDeviceId (not this phase)", !/designatedMasterDeviceId/.test(branchModel));
  assert("Device model gained no durableDeviceId (semantics unchanged)", !/durableDeviceId/.test(deviceModel));
}

  console.log(`\n${pass} passed, ${fail} failed`);
}

void main();
