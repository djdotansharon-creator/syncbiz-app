/**
 * Control Room — deleting a branch (PR #61 review, 2026-10-23). Run: npx tsx scripts/verify-branch-delete.ts
 *  Part 1 (no DB): the code shape — one transaction, FOR UPDATE locks, the audit row, confirmName, and NO deleting of user assignments.
 *  Part 2 (THROWAWAY localhost DB via CR_VERIFY_DATABASE_URL, all migrations applied):
 *    - wrong / missing confirmName → 400 `confirm`, nothing deleted
 *    - users assigned to the branch → 409 `assignment` (+ count); the assignment survives, so `getAssignedBranchIds` still answers the branch — and the test shows WHY the old
 *      behaviour (deleting the assignments) was unsafe: a user with no assignments falls back to the pilot's "default" branch
 *    - a bound station / a designated MASTER → 409 `station`; the legacy default branch → 409 `default`; a member scope that names the branch → 409 `scope`
 *    - a clean delete writes ONE AuditLog row (action branch.delete, who, when, name / number) in the same transaction; a refused delete writes none
 *    - races with `redeemStationActivation` (the real function): activation first → the delete waits, then refuses (`station`); delete first → the activation waits, then fails and
 *      NO station is bound to the deleted branch
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

const VERIFY_URL = process.env.CR_VERIFY_DATABASE_URL ?? "";
const VERIFY_SAFE = !!VERIFY_URL && ["localhost", "127.0.0.1"].includes(new URL(VERIFY_URL).hostname) && !/syncbiz_dev|railway|rlwy|production/i.test(VERIFY_URL);
process.env.DATABASE_URL = VERIFY_SAFE ? VERIFY_URL : "postgresql://nobody:none@127.0.0.1:1/none";
process.env.SYNCBIZ_ACTIVATION_SECRET = process.env.SYNCBIZ_ACTIVATION_SECRET || "test-activation-secret-0123456789";
{
  const Mo = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _cache: Record<string, unknown> };
  const m = new Module("stub:server-only") as unknown as { loaded: boolean; exports: unknown };
  m.loaded = true; m.exports = {}; Mo._cache["stub:server-only"] = m;
  const orig = Mo._resolveFilename;
  Mo._resolveFilename = function (r: string, ...rest: unknown[]) { return r === "server-only" ? "stub:server-only" : orig.call(this, r, ...rest); };
}

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Part 1: the shape of the code ──
{
  const src = fs.readFileSync(path.resolve(__dirname, "../lib/branch-management.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function deleteBranch"));
  const route = fs.readFileSync(path.resolve(__dirname, "../app/api/control-room/branches/[id]/route.ts"), "utf8");
  assert("C1 deleteBranch: checks + audit + delete inside ONE prisma.$transaction", /prisma\.\$transaction\(\s*async \(tx\)/.test(fn) && /writeTenantAuditLog\(tx,/.test(fn) && /tx\.branch\.delete\(/.test(fn) && !/prisma\.branch\.delete/.test(fn));
  assert("C2 the branch row and its activation codes are locked FOR UPDATE before any check", /FROM "Branch"[^`]*FOR UPDATE/.test(fn) && /FROM "BranchActivationCode"[^`]*FOR UPDATE/.test(fn) && fn.indexOf("FOR UPDATE") < fn.indexOf("stationDevice.count"));
  assert("C3 user assignments are REFUSED (`assignment`), never deleted", /"assignment"/.test(fn) && !/userBranchAssignment\.deleteMany/.test(fn));
  assert("C4 the server requires confirmName === the branch's name (`confirm`)", /ctx\.confirmName/.test(fn) && /"confirm"/.test(fn));
  assert("C5 the route passes the typed name, the actor and the client IP", /confirmName: body\?\.confirmName/.test(route) && /userId: auth\.userId/.test(route) && /extractClientIp\(req\)/.test(route));
  // owner 2026-11-01: his own default branch is SHOWN as "You" but stored under another name — typing "You" could never match the stored name
  const view = fs.readFileSync(path.resolve(__dirname, "../components/control-room/all-branches-view.tsx"), "utf8");
  assert("C6 the screen keeps the STORED name beside the displayed one and sends the stored name when the owner types the displayed one (the guard stays: he must still type what the screen shows; the server still compares with the stored name)",
    /dbName: string;/.test(view) && /dbName: b\.name \|\| b\.code \|\| "Branch"/.test(view) && /typeToConfirm=\{deleting\.name\}/.test(view) && /confirmName: typed\.trim\(\) === deleting\.name\.trim\(\) \? deleting\.dbName : typed/.test(view) && /ctx\.confirmName\.trim\(\) !== cur\.name\.trim\(\)/.test(fn));
}

async function dbPart(): Promise<void> {
  if (!VERIFY_URL) { console.log("SKIP  Part 2 (set CR_VERIFY_DATABASE_URL to a THROWAWAY database with all migrations)"); return; }
  if (!VERIFY_SAFE) { assert("Part 2 refuses a non-throwaway database", false, "refused"); return; }
  const { prisma } = await import("../lib/prisma");
  const bm = await import("../lib/branch-management");
  const { redeemStationActivation } = await import("../lib/station-activation");
  const { getAssignedBranchIds } = await import("../lib/user-store");
  const t = Date.now();
  const ws = await prisma.workspace.create({ data: { name: "Branch delete verify", slug: `bd-${t}`, owner: { create: { email: `bd-owner-${t}@example.test` } } } as never });
  const actor = ws.ownerId as string;
  await prisma.workspace.update({ where: { id: ws.id }, data: { stationIdPrefix: "VDEL" } });
  const worker = await prisma.user.create({ data: { email: `bd-worker-${t}@example.test` } as never });
  const member = await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: worker.id, role: "CONTROLLER" } });
  let n = 0;
  const mk = (name: string, extra: Record<string, unknown> = {}) => prisma.branch.create({ data: { workspaceId: ws.id, name, code: `BD${++n}`, locationCode: `BD${n}`, timezone: "Asia/Jerusalem", status: "active", ...extra } as never });
  const exists = async (id: string) => !!(await prisma.branch.findUnique({ where: { id }, select: { id: true } }));
  const attempt = async (id: string, confirmName: unknown): Promise<{ ok: boolean; code?: string; status?: number; count?: number }> => {
    try { await bm.deleteBranch(ws.id, id, { userId: actor, confirmName, ipAddress: "203.0.113.9" }); return { ok: true }; }
    catch (e) { const x = e as { code?: string; status?: number; count?: number }; return { ok: false, code: x.code, status: x.status, count: x.count }; }
  };
  const audits = () => prisma.auditLog.findMany({ where: { workspaceId: ws.id, action: "branch.delete" }, orderBy: { createdAt: "asc" } });

  // confirmName
  const b1 = await mk("סניף בדיקה");
  let r = await attempt(b1.id, undefined);
  assert("D1 no confirmName → 400 `confirm`, branch kept", !r.ok && r.code === "confirm" && r.status === 400 && (await exists(b1.id)));
  r = await attempt(b1.id, "סניף אחר");
  assert("D2 a different name → 400 `confirm`, branch kept", !r.ok && r.code === "confirm" && (await exists(b1.id)));

  // assignments (the review's finding)
  await prisma.userBranchAssignment.create({ data: { workspaceId: ws.id, userId: worker.id, branchId: b1.id } });
  r = await attempt(b1.id, "סניף בדיקה");
  const asg = await prisma.userBranchAssignment.count({ where: { workspaceId: ws.id, branchId: b1.id } });
  assert("D3 a user is assigned → 409 `assignment` (count 1); branch AND the assignment are still there", !r.ok && r.code === "assignment" && r.status === 409 && r.count === 1 && asg === 1 && (await exists(b1.id)));
  const keptIds = await getAssignedBranchIds(worker.id, ws.id);
  assert("D4 the worker still reaches ONLY their branch (never the pilot's \"default\")", keptIds.includes(b1.id) && !keptIds.includes("default"), JSON.stringify(keptIds));
  // why the old behaviour was unsafe: with the assignment gone the same user falls back to "default"
  await prisma.userBranchAssignment.deleteMany({ where: { workspaceId: ws.id, branchId: b1.id } });
  const leakedIds = await getAssignedBranchIds(worker.id, ws.id);
  assert("D5 (the danger the guard prevents) a user with NO assignment falls back to \"default\" — deleting the assignments would have given them the pilot branch", leakedIds.includes("default"), JSON.stringify(leakedIds));
  assert("D6 refused deletes wrote no audit row", (await audits()).length === 0);

  // station / designation
  const bs = await mk("Station branch");
  const dev = await prisma.stationDevice.create({ data: { durableDeviceId: `dsk-bd-${t}-a`, workspaceId: ws.id, branchId: bs.id, platform: "win32", appVersion: "0.0.0" } });
  r = await attempt(bs.id, "Station branch");
  assert("D7 a bound StationDevice → 409 `station`, branch kept", !r.ok && r.code === "station" && (await exists(bs.id)));
  await prisma.stationDevice.delete({ where: { id: dev.id } });
  const des = await prisma.branchMasterDesignation.create({ data: { workspaceId: ws.id, branchId: bs.id, durableDeviceId: `dsk-bd-${t}-b`, designatedBy: actor } });
  r = await attempt(bs.id, "Station branch");
  assert("D8 a designated MASTER → 409 `station`, branch kept", !r.ok && r.code === "station" && (await exists(bs.id)));
  await prisma.branchMasterDesignation.delete({ where: { id: des.id } });

  // legacy default
  const bl = await mk("Legacy", { legacyKey: "default" });
  r = await attempt(bl.id, "Legacy");
  assert("D9 the legacy default branch → 409 `default`", !r.ok && r.code === "default" && (await exists(bl.id)));

  // scope
  const bc = await mk("Scoped");
  const scope = await prisma.memberScope.create({ data: { memberId: member.id, workspaceId: ws.id, userId: worker.id, preset: "BRANCH_MANAGER", source: "admin", sourceRef: `t${t}` } });
  await prisma.memberScopeTarget.create({ data: { scopeId: scope.id, workspaceId: ws.id, dimension: "LOCATION", branchId: bc.id } });
  r = await attempt(bc.id, "Scoped");
  assert("D10 a member scope names the branch → 409 `scope`, branch kept", !r.ok && r.code === "scope" && (await exists(bc.id)));

  // clean delete + audit
  const before = Date.now();
  r = await attempt(b1.id, "  סניף בדיקה ");
  const rows = await audits();
  const md = (rows[0]?.metadata ?? {}) as { branchName?: string; branchNumber?: string };
  assert("D11 a clean delete (typed name, trimmed) → branch gone", r.ok && !(await exists(b1.id)));
  assert("D12 ONE AuditLog row: branch.delete / branch / the branch id / the actor / the IP / when / name + number", rows.length === 1 && rows[0]!.entity === "branch" && rows[0]!.entityId === b1.id && rows[0]!.userId === actor && rows[0]!.ipAddress === "203.0.113.9" && rows[0]!.createdAt.getTime() >= before - 2000 && md.branchName === "סניף בדיקה" && md.branchNumber === b1.locationCode);

  // ── races with the real activation ──
  const makeStationBranch = async (name: string) => {
    const b = await mk(name);
    const { code, stationId } = await bm.createActivationCode(ws.id, b.id, actor);
    return { b, code, stationId };
  };
  // R1: an activation is already running (holds the code row, has bound the station) → the delete waits, then refuses
  {
    const { b, code } = await makeStationBranch("Race one");
    const durable = `dsk-race1-${t}`;
    let release!: () => void; const gate = new Promise<void>((res) => { release = res; });
    let started!: () => void; const bound = new Promise<void>((res) => { started = res; });
    const redeem = prisma.$transaction(async (tx) => {
      const used = await tx.branchActivationCode.updateMany({ where: { branchId: b.id, usedAt: null, revokedAt: null }, data: { usedAt: new Date(), usedByDurableDeviceId: durable } });
      await tx.stationDevice.create({ data: { durableDeviceId: durable, workspaceId: ws.id, branchId: b.id, platform: "desktop", appVersion: "t" } });
      await tx.branchMasterDesignation.create({ data: { workspaceId: ws.id, branchId: b.id, durableDeviceId: durable, designatedBy: actor } });
      started(); await gate; return used.count;
    });
    await bound;
    let settled = false;
    const del = attempt(b.id, "Race one").then((x) => { settled = true; return x; });
    await sleep(800);
    const waiting = !settled;
    release(); await redeem;
    const res = await del;
    assert("R1 activation first: the delete WAITS for it, then refuses (`station`) — the station is intact and the branch kept", waiting && !res.ok && res.code === "station" && (await exists(b.id)) && !!(await prisma.stationDevice.findUnique({ where: { durableDeviceId: durable } })) && code.length === 6);
  }
  // R2: the delete holds the locks (same order, same statements) → the REAL activation waits, then fails; no station is bound to the deleted branch
  {
    const { b, code, stationId } = await makeStationBranch("Race two");
    const durable = `dsk-race2-${t}`;
    let release!: () => void; const gate = new Promise<void>((res) => { release = res; });
    let locked!: () => void; const holding = new Promise<void>((res) => { locked = res; });
    const deleter = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${b.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "BranchActivationCode" WHERE "branchId" = ${b.id} FOR UPDATE`;
      await tx.branch.delete({ where: { id: b.id } });
      locked(); await gate;
    });
    await holding;
    let settled = false;
    const act = redeemStationActivation({ workspaceId: ws.id, userId: actor, stationId, code, durableDeviceId: durable }).then(() => { settled = true; return "bound"; }, (e: unknown) => { settled = true; return `refused:${(e as { status?: number }).status ?? "?"}`; });
    await sleep(800);
    const waiting = !settled;
    release(); await deleter;
    const outcome = await act;
    const orphan = await prisma.stationDevice.count({ where: { durableDeviceId: durable } }) + (await prisma.branchMasterDesignation.count({ where: { durableDeviceId: durable } }));
    assert("R2 delete first: the activation WAITS, then fails — NO station / main-station row exists for the deleted branch", waiting && outcome.startsWith("refused") && orphan === 0 && !(await exists(b.id)), `${outcome}, orphan rows: ${orphan}`);
  }
}

void (async () => {
  await dbPart();
  console.log(`\n${pass} passed, ${fail} failed`);
  const { prisma } = await import("../lib/prisma").catch(() => ({ prisma: null as never }));
  await (prisma as { $disconnect?: () => Promise<void> } | null)?.$disconnect?.();
})();
