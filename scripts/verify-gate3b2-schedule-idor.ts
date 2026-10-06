/**
 * CONTROL ROOM GATE 3B-2 — Schedule-by-ID cross-workspace IDOR.
 *
 * Calls the REAL app/api/schedules/[id] GET / PATCH / DELETE handlers against an in-memory fake Prisma with two
 * workspaces (real signed session cookie; next/headers, next/cache, server-only stubbed for this process only).
 * No DB, no network.
 * Run: npx tsx scripts/verify-gate3b2-schedule-idor.ts
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

const cookieJar = new Map<string, string>();
const stubs: Record<string, unknown> = {
  "server-only": {},
  "next/headers": { cookies: async () => ({ get: (n: string) => (cookieJar.has(n) ? { name: n, value: cookieJar.get(n)! } : undefined) }) },
  "next/cache": { revalidatePath: () => {} },
};
const M = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const origResolve = M._resolveFilename;
for (const [id, exp] of Object.entries(stubs)) {
  const m = new Module(`stub:${id}`) as unknown as { loaded: boolean; exports: unknown };
  m.loaded = true; m.exports = exp; M._cache[`stub:${id}`] = m;
}
M._resolveFilename = function (r: string, ...rest: unknown[]) { return r in stubs ? `stub:${r}` : origResolve.call(this, r, ...rest); };
process.env.SYNCBIZ_SESSION_SECRET = "test-session-secret-not-real-0123456789";
process.env.SYNCBIZ_WS_SECRET = "test-secret-not-real-0123456789";

const A = "aaaaaaaa-0000-4000-8000-00000000000a", B = "bbbbbbbb-0000-4000-8000-00000000000b";
const A_CANON = "a0a0a0a0-0000-4000-8000-0000000000a0", A_OTHER = "a0a0a0a0-0000-4000-8000-0000000000a2";
const B_CANON = "b0b0b0b0-0000-4000-8000-0000000000b0";
const U = "user-a";
const T0 = new Date("2026-01-01");
const users = [{ id: U, email: "ua@test.local", name: null, passwordHash: null, createdAt: T0, status: "ACTIVE", role: "CONTROLLER" }];
type Mem = { workspaceId: string; userId: string; role: string; status: string; createdAt: Date; workspace: { id: string; ownerId: string } };
let members: Mem[] = [];
let assignments: { userId: string; workspaceId: string; branchId: string; role: string }[] = [];
const branches = [
  { id: A_CANON, workspaceId: A, legacyKey: "default" }, { id: A_OTHER, workspaceId: A, legacyKey: null },
  { id: B_CANON, workspaceId: B, legacyKey: "default" }, { id: "default", workspaceId: B, legacyKey: null },
];
const sched = (id: string, ws: string, branchId: string) => ({
  id, workspaceId: ws, branchId, playlistId: null, name: `S-${id}`, cronExpr: null, timezone: "UTC", status: "ACTIVE", targetType: "PLAYLIST",
  targetId: "p", sourceId: null, deviceId: null, recurrence: "weekly", oneOffDateLocal: null, daysOfWeek: [1], startTimeLocal: "09:00",
  endTimeLocal: "23:59", enabled: true, priority: 1, requestedStartPosition: null, requestedEndPosition: null, createdBy: null, updatedBy: null,
  taxonomyTags: null, startDate: null, endDate: null, createdAt: T0, updatedAt: T0,
});
let schedules: ReturnType<typeof sched>[] = [];
const idOnlyWrites: string[] = [];
const matchWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in (v as object) ? (v as { in: unknown[] }).in.includes(row[k]) : row[k] === v));
(globalThis as unknown as { prisma: unknown }).prisma = {
  user: { findUnique: async ({ where }: { where: { id?: string; email?: string } }) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null },
  workspace: { findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => ([A, B].includes(where.id ?? "") ? { id: where.id } : null) },
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
  schedule: {
    findUnique: async ({ where }: { where: { id: string } }) => schedules.find((s) => s.id === where.id) ?? null,
    findFirst: async ({ where }: { where: Record<string, unknown> }) => schedules.find((s) => matchWhere(s, where)) ?? null,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (!("workspaceId" in where)) idOnlyWrites.push("updateMany");
      const hit = schedules.filter((s) => matchWhere(s, where)); hit.forEach((s) => Object.assign(s, data)); return { count: hit.length };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      if (!("workspaceId" in where)) idOnlyWrites.push("deleteMany");
      const before = schedules.length; schedules = schedules.filter((s) => !matchWhere(s, where)); return { count: before - schedules.length };
    },
    update: async () => { idOnlyWrites.push("update"); throw new Error("id-only update must not be used"); },
    delete: async () => { idOnlyWrites.push("delete"); throw new Error("id-only delete must not be used"); },
  },
};
const mem = (ws: string, role: string, owner: string): Mem => ({ workspaceId: ws, userId: U, role, status: "ACTIVE", createdAt: T0, workspace: { id: ws, ownerId: owner } });

(async () => {
  const R = (await import("../app/api/schedules/[id]/route")) as unknown as Record<string, (r: unknown, c: unknown) => Promise<Response>>;
  const { createSessionValue } = await import("../lib/auth-session");
  const { NextRequest } = await import("next/server");
  const call = async (method: "GET" | "PATCH" | "DELETE", id: string, body?: unknown) => {
    const req = new NextRequest(`http://t.local/api/schedules/${id}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
    return (await R[method](req, { params: Promise.resolve({ id }) })).status;
  };
  const login = async (ws: string | null) => {
    cookieJar.clear();
    if (!ws) return;
    cookieJar.set("syncbiz-session", await createSessionValue("ua@test.local"));
    cookieJar.set("syncbiz-active-workspace-id", ws);
  };
  const origErr = console.error; console.error = () => {};
  const origLog = console.log;
  const quiet = (fn: () => Promise<void>) => async () => { console.log = () => {}; try { await fn(); } finally { console.log = origLog; } };
  const snap = (id: string) => JSON.stringify(schedules.find((s) => s.id === id) ?? null);
  const r: Record<string, number> = {};

  // A. OWNER of A, no membership in B, exact Schedule B id
  members = [mem(A, "WORKSPACE_ADMIN", U)]; assignments = [];
  schedules = [sched("sB", B, B_CANON), sched("sA", A, A_CANON)];
  const sB0 = snap("sB");
  await quiet(async () => { await login(A); r.aGet = await call("GET", "sB"); r.aPatch = await call("PATCH", "sB", { name: "pwned" }); r.aDel = await call("DELETE", "sB"); })();
  assert("A: OWNER of A → GET Schedule B = 404", r.aGet === 404);
  assert("A: OWNER of A → PATCH Schedule B = 404", r.aPatch === 404);
  assert("A: OWNER of A → DELETE Schedule B = 404", r.aDel === 404);
  assert("A: Schedule B unchanged and not deleted", snap("sB") === sB0);

  // B. branch user of A ("default") → B schedule on stub "default"
  members = [mem(A, "CONTROLLER", "x")]; assignments = [{ userId: U, workspaceId: A, branchId: "default", role: "BRANCH_CONTROLLER" }];
  schedules = [sched("sB2", B, "default")];
  const sB2 = snap("sB2");
  await quiet(async () => { await login(A); r.bGet = await call("GET", "sB2"); r.bPatch = await call("PATCH", "sB2", { name: "x" }); r.bDel = await call("DELETE", "sB2"); })();
  assert("B: branch user (legacy 'default') → B schedule on 'default' GET/PATCH/DELETE = 404", r.bGet === 404 && r.bPatch === 404 && r.bDel === 404 && snap("sB2") === sB2);

  // C. B canonical branch → 404 at the workspace step (not 403 from branch logic)
  schedules = [sched("sB3", B, B_CANON)];
  await quiet(async () => { await login(A); r.c = await call("GET", "sB3"); })();
  assert("C: B schedule on B's canonical branch → 404 (workspace isolation, before alias / branch logic)", r.c === 404);

  // D. valid schedule in the active workspace
  members = [mem(A, "WORKSPACE_ADMIN", U)]; assignments = [];
  schedules = [sched("sA", A, A_CANON)];
  await quiet(async () => { await login(A); r.dGet = await call("GET", "sA"); r.dPatch = await call("PATCH", "sA", { name: "renamed" }); })();
  assert("D: same-workspace GET = 200, PATCH = 200 (row updated)", r.dGet === 200 && r.dPatch === 200 && schedules[0]?.name === "renamed");
  await quiet(async () => { r.dDel = await call("DELETE", "sA"); })();
  assert("D: same-workspace DELETE = 200 (row removed)", r.dDel === 200 && schedules.length === 0);
  members = [mem(A, "CONTROLLER", "x")]; assignments = [{ userId: U, workspaceId: A, branchId: "default", role: "BRANCH_CONTROLLER" }];
  schedules = [sched("sA2", A, A_CANON)];
  await quiet(async () => { await login(A); r.dBranch = await call("GET", "sA2"); })();
  assert("D: same-workspace branch user via legacy 'default' ≡ A canonical → 200 (alias unchanged)", r.dBranch === 200);

  // E. unknown id / F. no session
  await quiet(async () => { await login(A); r.e = await call("GET", "nope"); r.ePatch = await call("PATCH", "nope", { name: "x" }); r.eDel = await call("DELETE", "nope"); })();
  assert("E: unknown id → 404 (GET / PATCH / DELETE)", r.e === 404 && r.ePatch === 404 && r.eDel === 404);
  await quiet(async () => { await login(null); r.f = await call("GET", "sA2"); r.fPatch = await call("PATCH", "sA2", { name: "x" }); r.fDel = await call("DELETE", "sA2"); })();
  assert("F: no session → 401 (GET / PATCH / DELETE)", r.f === 401 && r.fPatch === 401 && r.fDel === 401);

  // G. same workspace, unassigned branch
  schedules = [sched("sA3", A, A_OTHER)];
  await quiet(async () => { await login(A); r.g = await call("GET", "sA3"); r.gPatch = await call("PATCH", "sA3", { name: "x" }); r.gDel = await call("DELETE", "sA3"); })();
  assert("G: same-workspace schedule on unassigned branch → 403 (GET / PATCH / DELETE), row intact", r.g === 403 && r.gPatch === 403 && r.gDel === 403 && schedules.length === 1);
  console.error = origErr;

  // H. static
  assert("H: no id-only schedule write was executed by the [id] handlers", idOnlyWrites.length === 0, idOnlyWrites.join(","));
  const route = read("app", "api", "schedules", "[id]", "route.ts");
  const store = read("lib", "store.ts");
  const upd = store.slice(store.indexOf("async updateSchedule("), store.indexOf("async ensureSchedulesLoaded"));
  assert("H: [id] route loads via findScheduleInWorkspace only (no findScheduleById / getSchedule)",
    /db\.findScheduleInWorkspace\(id, resolveAccountScope\(user\.tenantId\)\)/.test(route) && !/findScheduleById|db\.getSchedule\(/.test(route));
  assert("H: mismatch 'log and fall through' removed", !/workspace mismatch/.test(route) && !/fall through/.test(route));
  assert("H: store update/delete are workspace-bound (updateMany / deleteMany with id + workspaceId)",
    /updateMany\(\{\s*where: \{ id: sid, workspaceId: wsId \}/.test(upd) && /deleteMany\(\{ where: \{ id: sid, workspaceId: wsId \} \}\)/.test(upd) &&
    !/prisma\.schedule\.update\(|prisma\.schedule\.delete\(/.test(upd));
  assert("H: authz mode still SHADOW", /export const AUTHZ_RUNTIME_MODE: AuthzMode = "shadow";/.test(read("lib", "authz.ts")));
  assert("H: WS server untouched (no schedule logic)", !/findScheduleInWorkspace/.test(read("server", "index.ts")));
  assert("H: shadow hooks still present on PATCH / DELETE", (route.match(/shadowAuthorize\("schedules\/\[id\]:(PATCH|DELETE)"/g) ?? []).length === 2);

  console.log(`\n${pass} passed, ${fail} failed`);
})();
