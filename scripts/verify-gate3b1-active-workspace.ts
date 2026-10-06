/**
 * CONTROL ROOM GATE 3B-1 — active-workspace isolation (no primary-workspace authorization drift).
 *
 * Runs the REAL auth helpers (lib/auth-helpers.ts, lib/user-store.ts, lib/playlist-access.ts) against an in-memory
 * fake Prisma with two workspaces. `next/headers` (cookies) and `server-only` are stubbed for this test process
 * only, so the real requireAdmin / bearer resolution run with real signed session cookies and real signed tokens.
 * No DB, no network.
 * Run: npx tsx scripts/verify-gate3b1-active-workspace.ts
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");

// ── test-process stubs: server-only (no-op) and next/headers (cookie jar we control) ─────────────────────────
const cookieJar = new Map<string, string>();
const stubs: Record<string, unknown> = {
  "server-only": {},
  "next/headers": { cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }) },
};
const M = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const origResolve = M._resolveFilename;
for (const [id, exp] of Object.entries(stubs)) {
  const m = new Module(`stub:${id}`) as unknown as { loaded: boolean; exports: unknown };
  m.loaded = true; m.exports = exp;
  M._cache[`stub:${id}`] = m;
}
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request in stubs) return `stub:${request}`;
  return origResolve.call(this, request, ...rest);
};

process.env.SYNCBIZ_WS_SECRET = "test-secret-not-real-0123456789";
process.env.SYNCBIZ_SESSION_SECRET = "test-session-secret-not-real-0123456789";

// ── fake Prisma: two workspaces ───────────────────────────────────────────────────────────────────────────────
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const B_BRANCH = "b0b0b0b0-0000-4000-8000-0000000000b1";
const B_OTHER = "b0b0b0b0-0000-4000-8000-0000000000b2";
const A_BRANCH = "a0a0a0a0-0000-4000-8000-0000000000a1";
const U = "user-1";
const T0 = new Date("2026-01-01");
const users = [{ id: U, email: "u1@test.local", name: null, passwordHash: null, createdAt: T0, status: "ACTIVE", role: "CONTROLLER" }];
type Mem = { workspaceId: string; userId: string; role: string; status: string; createdAt: Date; workspace: { id: string; ownerId: string } };
let members: Mem[] = [];
let assignments: { userId: string; workspaceId: string; branchId: string; role: string }[] = [];
const branches = [
  { id: B_BRANCH, workspaceId: B, legacyKey: null }, { id: B_OTHER, workspaceId: B, legacyKey: null },
  { id: A_BRANCH, workspaceId: A, legacyKey: null },
];
const matchWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in (v as object) ? (v as { in: unknown[] }).in.includes(row[k]) : row[k] === v));
(globalThis as unknown as { prisma: unknown }).prisma = {
  user: { findUnique: async ({ where }: { where: { id?: string; email?: string } }) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null },
  workspaceMember: {
    findMany: async ({ where }: { where: { userId: string } }) => members.filter((m) => m.userId === where.userId),
    findUnique: async ({ where }: { where: { workspaceId_userId: { workspaceId: string; userId: string } } }) =>
      members.find((m) => m.workspaceId === where.workspaceId_userId.workspaceId && m.userId === where.workspaceId_userId.userId) ?? null,
  },
  userBranchAssignment: {
    findMany: async ({ where }: { where: Record<string, unknown> }) => assignments.filter((a) => matchWhere(a, where)),
    findFirst: async ({ where }: { where: Record<string, unknown> }) => assignments.find((a) => matchWhere(a, where)) ?? null,
  },
  branch: {
    findUnique: async ({ where }: { where: { id?: string; workspaceId_legacyKey?: { workspaceId: string; legacyKey: string } } }) => {
      if (where.id) return branches.find((b) => b.id === where.id) ?? null;
      const k = where.workspaceId_legacyKey!;
      return branches.find((b) => b.workspaceId === k.workspaceId && b.legacyKey === k.legacyKey) ?? null;
    },
    findMany: async ({ where }: { where: { workspaceId: string } }) => branches.filter((b) => b.workspaceId === where.workspaceId).map((b) => ({ id: b.id })),
  },
  identityAuditLog: { create: async () => ({}) },
};
const mem = (workspaceId: string, role: string, ownerId: string, createdAt = T0, status = "ACTIVE"): Mem =>
  ({ workspaceId, userId: U, role, status, createdAt, workspace: { id: workspaceId, ownerId } });

(async () => {
  const H = await import("../lib/auth-helpers");
  const S = await import("../lib/user-store");
  const PA = await import("../lib/playlist-access");
  const { createSessionValue } = await import("../lib/auth-session");
  const { createWsToken, createDesktopAccessToken } = await import("../lib/auth-ws-token");
  const session = async (activeWs: string | null) => {
    cookieJar.clear();
    cookieJar.set("syncbiz-session", await createSessionValue("u1@test.local"));
    if (activeWs) cookieJar.set("syncbiz-active-workspace-id", activeWs);
  };
  const bearerReq = (token: string) => new Request("http://t.local/api/x", { headers: { authorization: `Bearer ${token}` } });

  // ── A. ADMIN in A (primary, owned), CONTROLLER in B, ACTIVE = B ─────────────────────────────────────────────
  members = [mem(A, "WORKSPACE_ADMIN", U, T0), mem(B, "CONTROLLER", "someone-else", new Date("2026-02-01"))];
  assignments = [{ userId: U, workspaceId: B, branchId: B_BRANCH, role: "BRANCH_CONTROLLER" }];
  await session(B);
  const sessU = await H.getCurrentUserFromCookies();
  assert("A: session resolves to the ACTIVE workspace B", sessU?.tenantId === B);
  assert("A: primary workspace is A (precondition)", (await S.getUserById(U))?.tenantId === A);
  assert("A: requireAdmin → DENY in B (was ALLOW via primary A)", (await H.requireAdmin()) === null);
  assert("A: hasTenantAdminRole(U, B) false", (await H.hasTenantAdminRole(U, B)) === false);
  assert("A: isOwner(U, B) → DENY (MASTER designation route gate)", (await H.isOwner(U, B)) === false);
  assert("A: getAccessTypeForUser(U, B) = BRANCH_USER (branches.manage gate)", (await H.getAccessTypeForUser(U, B)) === "BRANCH_USER");
  assert("A: assigned branches = only the assigned B branch (not '*')", JSON.stringify(await H.getAssignedBranchIdsForUser(U, B)) === JSON.stringify([B_BRANCH]));
  assert("A: hasBranchAccess assigned B branch ✓ / unassigned B branch ✗",
    (await H.hasBranchAccess(U, B_BRANCH, B)) === true && (await H.hasBranchAccess(U, B_OTHER, B)) === false);
  assert("A: (still ADMIN in its own workspace A)", (await H.hasTenantAdminRole(U, A)) === true && (await H.isOwner(U, A)) === true);
  members = [mem(A, "WORKSPACE_ADMIN", U, T0), mem(B, "VIEWER", "someone-else", new Date("2026-02-01"))];
  assert("A (VIEWER in B): requireAdmin DENY, unassigned branch DENY", (await H.requireAdmin()) === null && (await H.hasBranchAccess(U, B_OTHER, B)) === false);

  // ── B. Inverse: ACTIVE = A, no membership in B, B branch supplied manually ───────────────────────────────────
  members = [mem(A, "CONTROLLER", "x", T0)];
  assignments = [{ userId: U, workspaceId: A, branchId: A_BRANCH, role: "BRANCH_CONTROLLER" }];
  await session(A);
  assert("B: B branch id supplied from active A (branch user) → DENY", (await H.hasBranchAccess(U, B_BRANCH, A)) === false);
  assert("B: explicit workspace B with no membership → no access at all", (await H.hasBranchAccess(U, B_BRANCH, B)) === false &&
    JSON.stringify(await H.getAssignedBranchIdsForUser(U, B)) === "[]" && (await H.isOwner(U, B)) === false);
  assert("B: active-workspace cookie pointing at B is rejected (session stays A)", ((await session(B)), (await H.getCurrentUserFromCookies())?.tenantId) === A);

  // ── C. CONTROLLER in primary A, ADMIN in ACTIVE B → gets B's ADMIN rights ────────────────────────────────────
  members = [mem(A, "CONTROLLER", "x", T0), mem(B, "WORKSPACE_ADMIN", "y", new Date("2026-02-01"))];
  assignments = [{ userId: U, workspaceId: A, branchId: A_BRANCH, role: "BRANCH_CONTROLLER" }];
  await session(B);
  assert("C: primary is A (CONTROLLER) (precondition)", (await S.getUserById(U))?.tenantId === A);
  assert("C: requireAdmin → ALLOW in active B (was DENY via primary A)", (await H.requireAdmin())?.tenantId === B);
  assert("C: isOwner(U, B) true, '*' branches in B", (await H.isOwner(U, B)) === true && JSON.stringify(await H.getAssignedBranchIdsForUser(U, B)) === '["*"]');

  // ── D. explicit workspace without membership → getTenantRole null ────────────────────────────────────────────
  members = [mem(A, "WORKSPACE_ADMIN", U, T0)];
  assert("D: getTenantRole(U, B) with no membership in B → null (no primary fallback)", (await S.getTenantRole(U, B)) === null);
  assert("D: getTenantRole(U, A) → TENANT_OWNER (membership exists)", (await S.getTenantRole(U, A)) === "TENANT_OWNER");
  members = [mem(A, "WORKSPACE_ADMIN", U, T0), mem(B, "MANAGER", "y", new Date("2026-02-01"), "SUSPENDED")];
  assert("D: SUSPENDED in explicit B → null", (await S.getTenantRole(U, B)) === null);

  // ── E. Bearer: signed workspace only ────────────────────────────────────────────────────────────────────────
  members = [mem(A, "WORKSPACE_ADMIN", U, T0), mem(B, "CONTROLLER", "y", new Date("2026-02-01"))];
  cookieJar.clear(); // bearer is only used when there is no session cookie
  const viaB = await H.getCurrentUserFromApiRequest(bearerReq(createWsToken(U, { workspaceId: B, authorizedBranches: [B_BRANCH] })));
  assert("E: ws_register bearer → user resolved in its SIGNED workspace B (primary A ignored)", viaB?.tenantId === B);
  const viaDesk = await H.getCurrentUserFromApiRequest(bearerReq(createDesktopAccessToken(U, { workspaceId: B })));
  assert("E: desktop_access bearer → signed workspace B", viaDesk?.tenantId === B);
  assert("E: bearer with NO workspace claim → DENY (fail closed)", (await H.getCurrentUserFromApiRequest(bearerReq(createWsToken(U)))) === null);
  const C = "cccccccc-0000-4000-8000-00000000000c";
  assert("E: bearer for a workspace the user is NOT a member of → DENY (no fallback to primary)",
    (await H.getCurrentUserFromApiRequest(bearerReq(createWsToken(U, { workspaceId: C })))) === null);
  assert("E: tampered / invalid token → DENY", (await H.getCurrentUserFromApiRequest(bearerReq("abc.def"))) === null);
  members = [mem(A, "WORKSPACE_ADMIN", U, T0)];
  assert("E: valid current single-workspace token still works", (await H.getCurrentUserFromApiRequest(bearerReq(createDesktopAccessToken(U, { workspaceId: A }))))?.tenantId === A);
  await session(A);
  assert("E: a session cookie still wins over bearer (unchanged precedence)", (await H.getCurrentUserFromApiRequest(bearerReq(createWsToken(U, { workspaceId: C }))))?.tenantId === A);

  // ── playlist-access fallback (no active workspace) fails closed ────────────────────────────────────────────
  // A tenant that matches the row but is blank after trim is the only way to reach the "no active workspace" path.
  const pl = { id: "p1", name: "x", url: "u", type: "youtube", branchId: "default", tenantId: "  " } as unknown as Parameters<typeof PA.gatePlaylistAccess>[1];
  const g = await PA.gatePlaylistAccess({ id: U, tenantId: "  " } as unknown as Parameters<typeof PA.gatePlaylistAccess>[0], pl);
  assert("playlist-access: no active workspace → FAIL CLOSED (403), no primary helpers imported", !g.allow && (g as { httpStatus: number }).httpStatus === 403 &&
    !/import[^\n]*(getAssignedBranchIdsForUser|hasBranchAccess)/.test(read("lib", "playlist-access.ts")));

  // ── F. existing single-workspace behavior unchanged ─────────────────────────────────────────────────────────
  members = [mem(A, "WORKSPACE_ADMIN", U, T0)];
  assignments = [];
  await session(A);
  assert("F: single-workspace OWNER: requireAdmin / isOwner / '*' / any own branch", (await H.requireAdmin())?.tenantId === A && (await H.isOwner(U, A)) &&
    JSON.stringify(await H.getAssignedBranchIdsForUser(U, A)) === '["*"]' && (await H.hasBranchAccess(U, A_BRANCH, A)));
  members = [mem(A, "CONTROLLER", "x", T0)];
  assignments = [];
  assert("F: single-workspace member with no assignments keeps the implicit 'default' branch", JSON.stringify(await H.getAssignedBranchIdsForUser(U, A)) === '["default"]' &&
    (await H.hasBranchAccess(U, "default", A)) === true && (await H.requireAdmin()) === null);

  // ── static: no primary-workspace resolution left in the helpers; all call sites pass the active workspace ───
  const ah = read("lib", "auth-helpers.ts");
  const helperBlock = ah.slice(ah.indexOf("const activeWs = "), ah.indexOf("export async function getUserIdFromSession"));
  assert("helpers never call getUserById(userId) without a workspace", !/getUserById\(userId\)/.test(helperBlock) && /hasTenantAdminRole\(user\.id, user\.tenantId\)/.test(ah));
  const sites = [
    "app/api/playlists/route.ts", "app/api/playlists/ai-build/route.ts", "app/api/sources/route.ts", "app/api/sources/[id]/route.ts",
    "app/api/sources/add-from-catalog-track/route.ts", "app/api/sources/unified/route.ts", "app/api/radio/route.ts", "app/api/radio/[id]/route.ts",
    "app/api/schedules/route.ts", "app/api/schedules/[id]/route.ts", "app/api/admin/branch-master/route.ts", "app/api/branches/route.ts",
  ];
  const calls = sites.flatMap((f) => read(...f.split("/")).split("\n").filter((l) => /(hasBranchAccess|getAssignedBranchIdsForUser|getAccessTypeForUser|isOwner)\(/.test(l) && !/import /.test(l) && !/^\s*(\/\/|\*)/.test(l)));
  assert("every route call site passes the session tenantId", calls.length === 20 && calls.every((l) => /\.tenantId\)/.test(l)), `${calls.length} calls`);
  assert("WS server untouched", !/verifyWsTokenClaims|getCurrentUserFromApiRequest/.test(read("server", "index.ts")));
  assert("authz engine still SHADOW", /export const AUTHZ_RUNTIME_MODE: AuthzMode = "shadow";/.test(read("lib", "authz.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
})();
