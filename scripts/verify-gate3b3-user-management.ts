/**
 * CONTROL ROOM GATE 3B-3 — tenant user-management hardening.
 *
 * Calls the REAL /api/admin/users (GET / POST / PATCH / DELETE) and pause- / resume- / remove-member handlers with a
 * real signed session cookie, over an in-memory fake Prisma (multi-user, two workspaces). next/headers, next/cache,
 * server-only stubbed for this process only. No DB, no network.
 * Run: npx tsx scripts/verify-gate3b3-user-management.ts
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
  "next/headers": { cookies: async () => ({ get: (n: string) => (cookieJar.has(n) ? { name: n, value: cookieJar.get(n)! } : undefined) }), headers: async () => new Map() },
  "next/cache": { revalidatePath: () => {} },
};
const Mo = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
const origResolve = Mo._resolveFilename;
for (const [id, exp] of Object.entries(stubs)) {
  const m = new Module(`stub:${id}`) as unknown as { loaded: boolean; exports: unknown };
  m.loaded = true; m.exports = exp; Mo._cache[`stub:${id}`] = m;
}
Mo._resolveFilename = function (r: string, ...rest: unknown[]) { return r in stubs ? `stub:${r}` : origResolve.call(this, r, ...rest); };
process.env.SYNCBIZ_SESSION_SECRET = "test-session-secret-not-real-0123456789";
process.env.SYNCBIZ_WS_SECRET = "test-secret-not-real-0123456789";

const W = "aaaaaaaa-0000-4000-8000-00000000000a"; // the workspace under test (owner = "owner")
const X = "cccccccc-0000-4000-8000-00000000000c"; // victim's own other workspace
const T0 = new Date("2026-01-01");
type U = { id: string; email: string; name: string | null; passwordHash: string | null; createdAt: Date; status: string; role: string; deactivatedAt: Date | null };
type Mm = { workspaceId: string; userId: string; role: string; status: string; createdAt: Date; suspendedAt?: Date | null };
let users: U[] = [], members: Mm[] = [], uba: { userId: string; workspaceId: string; branchId: string; role: string }[] = [];
const workspaces = [{ id: W, slug: "w", ownerId: "owner", name: "W" }, { id: X, slug: "x", ownerId: "victim", name: "X" }];
function reset(): void {
  const u = (id: string, email: string, role = "CONTROLLER"): U => ({ id, email, name: null, passwordHash: "orig-hash", createdAt: T0, status: "ACTIVE", role, deactivatedAt: null });
  users = [u("owner", "owner@t.local"), u("mgr", "mgr@t.local"), u("mgr2", "mgr2@t.local"), u("admin2", "admin2@t.local"), u("admin3", "admin3@t.local"),
    u("ctl", "ctl@t.local"), u("victim", "victim@x.local"), u("plat", "plat@t.local", "SUPER_ADMIN")];
  const m = (workspaceId: string, userId: string, role: string): Mm => ({ workspaceId, userId, role, status: "ACTIVE", createdAt: T0 });
  members = [m(W, "owner", "WORKSPACE_ADMIN"), m(W, "mgr", "MANAGER"), m(W, "mgr2", "MANAGER"), m(W, "admin2", "WORKSPACE_ADMIN"),
    m(W, "admin3", "WORKSPACE_ADMIN"), m(W, "ctl", "CONTROLLER"), m(W, "plat", "WORKSPACE_ADMIN"), m(X, "victim", "WORKSPACE_ADMIN")];
  uba = [];
}
reset();
const findWs = (w: Record<string, unknown>) => {
  const conds = (w.OR as Record<string, unknown>[] | undefined) ?? [w];
  return workspaces.find((x) => conds.some((c) => (c.id && x.id === c.id) || (c.slug && x.slug === c.slug))) ?? null;
};
const withWs = (m: Mm) => ({ ...m, workspace: { id: m.workspaceId, ownerId: workspaces.find((w) => w.id === m.workspaceId)!.ownerId } });
const match = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === "object") {
    if ("not" in (v as object)) return row[k] !== (v as { not: unknown }).not;
    if ("in" in (v as object)) return (v as { in: unknown[] }).in.includes(row[k]);
  }
  return row[k] === v;
});
const mkey = (w: { workspaceId_userId: { workspaceId: string; userId: string } }) => (x: Mm) => x.workspaceId === w.workspaceId_userId.workspaceId && x.userId === w.workspaceId_userId.userId;
(globalThis as unknown as { prisma: unknown }).prisma = {
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null,
    create: async ({ data }: { data: Partial<U> }) => { const u = { id: `new-${users.length}`, name: null, createdAt: T0, status: "ACTIVE", role: "CONTROLLER", deactivatedAt: null, passwordHash: null, email: "", ...data } as U; users.push(u); return u; },
    update: async ({ where, data }: { where: { id: string }; data: Partial<U> }) => { const u = users.find((x) => x.id === where.id)!; Object.assign(u, data); return u; },
  },
  workspace: { findFirst: async ({ where }: { where: Record<string, unknown> }) => findWs(where), findUnique: async ({ where }: { where: Record<string, unknown> }) => findWs(where) },
  workspaceMember: {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      members.filter((m) => match(m as unknown as Record<string, unknown>, where)).map((m) => ({ ...withWs(m), user: users.find((u) => u.id === m.userId) })),
    findUnique: async ({ where }: { where: { workspaceId_userId: { workspaceId: string; userId: string } } }) => { const m = members.find(mkey(where)); return m ? withWs(m) : null; },
    create: async ({ data }: { data: Partial<Mm> & { workspaceId: string; userId: string; role: string } }) => {
      const m: Mm = { ...data, status: data.status ?? "ACTIVE", createdAt: data.createdAt ?? T0 }; members.push(m); return m;
    },
    update: async ({ where, data }: { where: { workspaceId_userId: { workspaceId: string; userId: string } }; data: Partial<Mm> }) => { const m = members.find(mkey(where))!; Object.assign(m, data); return m; },
    delete: async ({ where }: { where: { workspaceId_userId: { workspaceId: string; userId: string } } }) => { members = members.filter((x) => !mkey(where)(x)); return {}; },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => { const b = members.length; members = members.filter((x) => !match(x as unknown as Record<string, unknown>, where)); return { count: b - members.length }; },
    count: async ({ where }: { where: Record<string, unknown> }) => members.filter((m) => match(m as unknown as Record<string, unknown>, where)).length,
  },
  userBranchAssignment: {
    findMany: async () => [], findFirst: async () => null,
    deleteMany: async () => ({ count: 0 }),
    create: async ({ data }: { data: (typeof uba)[number] }) => { uba.push(data); return data; },
    upsert: async ({ create }: { create: (typeof uba)[number] }) => { uba.push(create); return create; },
  },
  branch: { findMany: async () => [], findUnique: async () => null, count: async () => 0 },
  workspaceEntitlement: { findUnique: async () => null },
  auditLog: { create: async () => ({}) },
  $transaction: async (fn: unknown) => (typeof fn === "function" ? (fn as (tx: unknown) => unknown)((globalThis as unknown as { prisma: unknown }).prisma) : Promise.all(fn as Promise<unknown>[])),
};

(async () => {
  type H = Record<string, (r?: unknown) => Promise<Response>>;
  const UR = (await import("../app/api/admin/users/route")) as unknown as H;
  const PR = (await import("../app/api/admin/users/pause-member/route")) as unknown as H;
  const RS = (await import("../app/api/admin/users/resume-member/route")) as unknown as H;
  const RM = (await import("../app/api/admin/users/remove-member/route")) as unknown as H;
  const { createSessionValue } = await import("../lib/auth-session");
  const { NextRequest } = await import("next/server");
  const req = (method: string, body: unknown) => new NextRequest("http://t.local/api/admin/users", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const as = async (email: string) => { cookieJar.clear(); cookieJar.set("syncbiz-session", await createSessionValue(email)); cookieJar.set("syncbiz-active-workspace-id", W); };
  const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => { const l = console.log, e = console.error, w = console.warn; console.log = console.error = console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; } };
  const st = (p: Promise<Response>) => quiet(() => p.then((r) => r.status));
  const role = (id: string, w = W) => members.find((m) => m.userId === id && m.workspaceId === w)?.role ?? "(none)";
  const mstatus = (id: string) => members.find((m) => m.userId === id && m.workspaceId === W)?.status;
  const hash = (id: string) => users.find((u) => u.id === id)!.passwordHash;
  const ustatus = (id: string) => users.find((u) => u.id === id)!.status;
  const fp = () => JSON.stringify([users, members]);

  // ── MANAGER (HQ_CONTROL): no users.manage at all ─────────────────────────────────────────────────────────────
  reset(); await as("mgr@t.local"); const before = fp();
  assert("MANAGER: GET users → 403", (await st(UR.GET())) === 403);
  assert("MANAGER: POST create WORKSPACE_ADMIN → 403", (await st(UR.POST(req("POST", { email: "x1@t.local", password: "secret123", accessType: "OWNER" })))) === 403);
  assert("MANAGER: POST create branch user → 403", (await st(UR.POST(req("POST", { email: "x2@t.local", password: "secret123", accessType: "BRANCH_USER", branchIds: [] })))) === 403);
  assert("MANAGER: PATCH promote CONTROLLER → 403", (await st(UR.PATCH(req("PATCH", { email: "ctl@t.local", accessType: "OWNER" })))) === 403);
  assert("MANAGER: PATCH self-promotion → 403", (await st(UR.PATCH(req("PATCH", { email: "mgr@t.local", accessType: "OWNER" })))) === 403);
  assert("MANAGER: DELETE → 403", (await st(UR.DELETE(req("DELETE", { email: "ctl@t.local" })))) === 403);
  assert("MANAGER: pause / resume / remove → 403",
    (await st(PR.POST(req("POST", { email: "ctl@t.local" })))) === 403 && (await st(RS.POST(req("POST", { email: "ctl@t.local" })))) === 403 && (await st(RM.POST(req("POST", { email: "ctl@t.local" })))) === 403);
  assert("MANAGER: nothing changed", fp() === before);

  // ── non-owner WORKSPACE_ADMIN (admin2) ──────────────────────────────────────────────────────────────────────
  reset(); await as("admin2@t.local");
  assert("ADMIN: GET users → 200", (await st(UR.GET())) === 200);
  assert("ADMIN: create branch user → 201", (await st(UR.POST(req("POST", { email: "new1@t.local", password: "secret123", accessType: "BRANCH_USER", branchIds: [] })))) === 201);
  assert("ADMIN: edit lower rank (MANAGER → branch user) → 200", (await st(UR.PATCH(req("PATCH", { email: "mgr2@t.local", accessType: "BRANCH_USER", branchIds: ["default"] })))) === 200 && role("mgr2") === "CONTROLLER");
  assert("ADMIN: pause + resume lower rank → 200", (await st(PR.POST(req("POST", { email: "ctl@t.local" })))) === 200 && mstatus("ctl") === "SUSPENDED" &&
    (await st(RS.POST(req("POST", { email: "ctl@t.local" })))) === 200 && mstatus("ctl") === "ACTIVE");
  assert("ADMIN: create WORKSPACE_ADMIN → 403", (await st(UR.POST(req("POST", { email: "new2@t.local", password: "secret123", accessType: "OWNER" })))) === 403);
  assert("ADMIN: promote CONTROLLER → WORKSPACE_ADMIN → 403", (await st(UR.PATCH(req("PATCH", { email: "ctl@t.local", accessType: "OWNER" })))) === 403 && role("ctl") === "CONTROLLER");
  assert("ADMIN: demote another WORKSPACE_ADMIN → 403", (await st(UR.PATCH(req("PATCH", { email: "admin3@t.local", accessType: "BRANCH_USER", branchIds: ["default"] })))) === 403 && role("admin3") === "WORKSPACE_ADMIN");
  assert("ADMIN: pause / remove another WORKSPACE_ADMIN → 403",
    (await st(PR.POST(req("POST", { email: "admin3@t.local" })))) === 403 && (await st(RM.POST(req("POST", { email: "admin3@t.local" })))) === 403 && mstatus("admin3") === "ACTIVE");
  assert("ADMIN: modify Workspace Owner (demote) → 403", (await st(UR.PATCH(req("PATCH", { email: "owner@t.local", accessType: "BRANCH_USER", branchIds: ["default"] })))) === 403 && role("owner") === "WORKSPACE_ADMIN");
  assert("ADMIN: modify Workspace Owner (keep role) → 403", (await st(UR.PATCH(req("PATCH", { email: "owner@t.local", accessType: "OWNER", name: "x" })))) === 403);
  assert("ADMIN: reset another user's password (lower rank) → 403", (await st(UR.PATCH(req("PATCH", { email: "ctl@t.local", accessType: "BRANCH_USER", branchIds: ["default"], newPassword: "takeover1" })))) === 403 && hash("ctl") === "orig-hash");
  assert("ADMIN: reset Workspace Owner's password → 403", (await st(UR.PATCH(req("PATCH", { email: "owner@t.local", accessType: "OWNER", newPassword: "takeover1" })))) === 403 && hash("owner") === "orig-hash");
  assert("ADMIN: global disable (DELETE) → 403", (await st(UR.DELETE(req("DELETE", { email: "ctl@t.local" })))) === 403 && ustatus("ctl") === "ACTIVE");
  assert("ADMIN: own password change (self) → 200", (await st(UR.PATCH(req("PATCH", { email: "admin2@t.local", accessType: "OWNER", newPassword: "mynewpass1" })))) === 200 && hash("admin2") !== "orig-hash");

  // ── cross-workspace takeover chains (as a legitimate WORKSPACE_ADMIN of W) ──────────────────────────────────
  reset(); await as("admin2@t.local");
  const inv = await st(UR.POST(req("POST", { email: "victim@x.local", password: "attacker1", accessType: "BRANCH_USER", branchIds: [] })));
  assert("takeover: invite of an existing user never touches their global password", hash("victim") === "orig-hash", `invite status ${inv}`);
  assert("takeover: PATCH victim newPassword → 403, victim password unchanged",
    (await st(UR.PATCH(req("PATCH", { email: "victim@x.local", accessType: "BRANCH_USER", branchIds: ["default"], newPassword: "takeover1" })))) === 403 && hash("victim") === "orig-hash");
  assert("takeover: global-disable victim → 403, victim stays enabled",
    (await st(UR.DELETE(req("DELETE", { email: "victim@x.local" })))) === 403 && ustatus("victim") === "ACTIVE" && role("victim", X) === "WORKSPACE_ADMIN");
  reset(); await as("owner@t.local");
  await st(UR.POST(req("POST", { email: "victim@x.local", accessType: "BRANCH_USER", branchIds: [] })));
  assert("takeover: even the Workspace Owner cannot set the victim's password", (await st(UR.PATCH(req("PATCH", { email: "victim@x.local", accessType: "BRANCH_USER", branchIds: ["default"], newPassword: "takeover1" })))) === 403 && hash("victim") === "orig-hash");

  // ── Workspace Owner ─────────────────────────────────────────────────────────────────────────────────────────
  reset(); await as("owner@t.local");
  assert("OWNER: lower-rank management works (create branch user 201, edit 200)",
    (await st(UR.POST(req("POST", { email: "new3@t.local", password: "secret123", accessType: "BRANCH_USER", branchIds: [] })))) === 201 &&
    (await st(UR.PATCH(req("PATCH", { email: "ctl@t.local", accessType: "BRANCH_USER", branchIds: ["default"] })))) === 200);
  assert("OWNER: create WORKSPACE_ADMIN → 201", (await st(UR.POST(req("POST", { email: "new4@t.local", password: "secret123", accessType: "OWNER" })))) === 201 &&
    role(users.find((u) => u.email === "new4@t.local")!.id) === "WORKSPACE_ADMIN");
  assert("OWNER: promote CONTROLLER → WORKSPACE_ADMIN → 200", (await st(UR.PATCH(req("PATCH", { email: "ctl@t.local", accessType: "OWNER" })))) === 200 && role("ctl") === "WORKSPACE_ADMIN");
  assert("OWNER: demote / pause / resume / remove another WORKSPACE_ADMIN → allowed",
    (await st(UR.PATCH(req("PATCH", { email: "admin3@t.local", accessType: "BRANCH_USER", branchIds: ["default"] })))) === 200 && role("admin3") === "CONTROLLER" &&
    (await st(PR.POST(req("POST", { email: "admin2@t.local" })))) === 200 && (await st(RS.POST(req("POST", { email: "admin2@t.local" })))) === 200 &&
    (await st(RM.POST(req("POST", { email: "admin2@t.local" })))) === 200 && role("admin2") === "(none)");
  assert("OWNER: cannot demote self (no implicit ownership transfer) → 403", (await st(UR.PATCH(req("PATCH", { email: "owner@t.local", accessType: "BRANCH_USER", branchIds: ["default"] })))) === 403 && role("owner") === "WORKSPACE_ADMIN");
  assert("OWNER: own name edit keeping role → 200", (await st(UR.PATCH(req("PATCH", { email: "owner@t.local", accessType: "OWNER", name: "Owner" })))) === 200);
  assert("OWNER: cannot set another user's password → 403", (await st(UR.PATCH(req("PATCH", { email: "ctl@t.local", accessType: "OWNER", newPassword: "x123456" })))) === 403);
  assert("OWNER: global disable → 403 (platform only)", (await st(UR.DELETE(req("DELETE", { email: "mgr2@t.local" })))) === 403 && ustatus("mgr2") === "ACTIVE");
  reset(); await as("admin2@t.local");
  assert("owner row cannot be paused / removed (by an admin)", (await st(PR.POST(req("POST", { email: "owner@t.local" })))) === 403 && (await st(RM.POST(req("POST", { email: "owner@t.local" })))) === 403);

  // ── platform SUPER_ADMIN (member of W as WORKSPACE_ADMIN, User.role SUPER_ADMIN) ────────────────────────────
  reset(); await as("plat@t.local");
  assert("PLATFORM: global disable still works (existing guards apply)", (await st(UR.DELETE(req("DELETE", { email: "ctl@t.local" })))) === 200 && ustatus("ctl") === "DISABLED");
  reset(); await as("plat@t.local");
  assert("PLATFORM: may set another user's password", (await st(UR.PATCH(req("PATCH", { email: "ctl@t.local", accessType: "BRANCH_USER", branchIds: ["default"], newPassword: "platset1" })))) === 200 && hash("ctl") !== "orig-hash");
  reset(); await as("plat@t.local");
  assert("PLATFORM: existing guards intact (cannot disable the workspace owner)", (await st(UR.DELETE(req("DELETE", { email: "owner@t.local" })))) === 403 && ustatus("owner") === "ACTIVE");
  assert("PLATFORM: cannot demote the workspace owner either", (await st(UR.PATCH(req("PATCH", { email: "owner@t.local", accessType: "BRANCH_USER", branchIds: ["default"] })))) === 403);

  // ── last-admin protection ───────────────────────────────────────────────────────────────────────────────────
  reset();
  members = members.filter((m) => !(m.workspaceId === W && ["admin2", "admin3", "plat"].includes(m.userId)));
  members.push({ workspaceId: W, userId: "admin2", role: "WORKSPACE_ADMIN", status: "ACTIVE", createdAt: T0 });
  members = members.map((m) => (m.workspaceId === W && m.userId === "owner" ? { ...m, status: "SUSPENDED" } : m)); // owner paused elsewhere → admin2 is the only ACTIVE admin
  await as("admin2@t.local");
  assert("LAST ADMIN: sole active admin cannot demote self → 400", (await st(UR.PATCH(req("PATCH", { email: "admin2@t.local", accessType: "BRANCH_USER", branchIds: ["default"] })))) === 400 && role("admin2") === "WORKSPACE_ADMIN");
  reset(); await as("admin2@t.local");
  assert("existing guard: cannot pause self → 400", (await st(PR.POST(req("POST", { email: "admin2@t.local" })))) === 400);

  // ── static ──────────────────────────────────────────────────────────────────────────────────────────────────
  const files = ["app/api/admin/users/route.ts", "app/api/admin/users/pause-member/route.ts", "app/api/admin/users/resume-member/route.ts", "app/api/admin/users/remove-member/route.ts"];
  const srcs = files.map((f) => read(...f.split("/")));
  assert("no requireAdmin on the 7 user-management handlers; requireWorkspaceAdmin used", srcs.every((s) => !/requireAdmin\(/.test(s)) &&
    (srcs[0].match(/await requireWorkspaceAdmin\(\)/g) ?? []).length === 4 && srcs.slice(1).every((s) => (s.match(/await requireWorkspaceAdmin\(\)/g) ?? []).length === 1));
  assert("admin/audit unchanged (still requireAdmin)", /requireAdmin\(\)/.test(read("app", "api", "admin", "audit", "route.ts")));
  assert("authz mode still SHADOW", /export const AUTHZ_RUNTIME_MODE: AuthzMode = "shadow";/.test(read("lib", "authz.ts")));
  assert("WS server untouched", !/requireWorkspaceAdmin|user-management-policy/.test(read("server", "index.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
})();
