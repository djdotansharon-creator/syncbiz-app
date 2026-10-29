/**
 * The Permissions screen's People list + giving an existing person another role, against a REAL (local) database (lib/people-store.ts, assignRoleToMember in lib/roles-store.ts).
 * REFUSES to run against anything but a localhost database.
 * Run: node --env-file=.env.development --require ./scripts/_test-stubs/preload.cjs --import tsx scripts/verify-people-db.ts
 */
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("REFUSED: DATABASE_URL is not a localhost database — this test creates and deletes rows.");
  process.exit(2);
}
process.env.SYNCBIZ_ROLES = "1";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}

async function main() {
  const { prisma } = await import("../lib/prisma");
  const people = await import("../lib/people-store");
  const roles = await import("../lib/roles-store");
  const tag = randomUUID().slice(0, 8);
  const mk = (n: string) => prisma.user.create({ data: { email: `${n}-${tag}@example.test`, name: n === "noname" ? null : `Person ${n}`, role: "CONTROLLER" } });
  const throws = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "";
    } catch (e) {
      return e instanceof roles.RoleError ? e.code : `other:${e instanceof Error ? e.message : String(e)}`;
    }
  };
  const owner = await mk("owner");
  const admin2 = await mk("admin2");
  const staff = await mk("staff");
  const noname = await mk("noname");
  const stranger = await mk("stranger");
  const paused = await mk("paused");
  const ws = await prisma.workspace.create({ data: { name: `People ${tag}`, slug: `people-${tag}`, ownerId: owner.id } });
  const other = await prisma.workspace.create({ data: { name: `People other ${tag}`, slug: `people-other-${tag}`, ownerId: owner.id } });
  await prisma.workspaceMember.createMany({ data: [
    { workspaceId: ws.id, userId: owner.id, role: "WORKSPACE_ADMIN" },
    { workspaceId: ws.id, userId: admin2.id, role: "WORKSPACE_ADMIN" },
    { workspaceId: ws.id, userId: staff.id, role: "CONTROLLER" },
    { workspaceId: ws.id, userId: noname.id, role: "MANAGER" },
    { workspaceId: ws.id, userId: paused.id, role: "CONTROLLER", status: "SUSPENDED" },
  ] });
  await prisma.user.update({ where: { id: staff.id }, data: { lastLoginAt: new Date(Date.now() - 5 * 60_000) } });
  const base = { workspaceId: ws.id, actorUserId: owner.id };

  try {
    const list = await people.listPeople(ws.id, owner.id);
    const by = (id: string) => list.find((p) => p.userId === id)!;
    assert("P1 everyone in the business is listed with name, level (owner / manager / member), state and last sign-in", list.length === 5 && by(owner.id).level === "owner" && by(admin2.id).level === "manager" && by(noname.id).level === "manager" && by(staff.id).level === "member" && by(paused.id).status === "paused" && by(staff.id).status === "active" && !!by(staff.id).lastSignInAt && by(owner.id).lastSignInAt === null);
    assert("P2 a person without a name shows the start of their e-mail; the caller is marked; another business is not mixed in", by(noname.id).name === `noname-${tag}`.split("@")[0] && by(owner.id).isYou && !by(staff.id).isYou && (await people.listPeople(other.id, owner.id)).length === 0);

    const rs = await roles.listRoles(ws.id);
    const manager = rs.find((r) => r.name === "Manager")!;
    const employee = rs.find((r) => r.name === "Employee")!;
    assert("P3 with roles on, a person has no role until given one", (await people.listPeople(ws.id, owner.id)).every((p) => p.roleName === null));
    await roles.assignRoleToMember({ ...base, userId: staff.id, roleId: manager.id });
    const after = (await people.listPeople(ws.id, owner.id)).find((p) => p.userId === staff.id)!;
    assert("P4 giving an existing person the Manager role shows it, and their platform level follows (a manager now)", after.roleName === "Manager" && after.level === "manager" && (await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: staff.id } } }))?.role === "MANAGER");
    await roles.assignRoleToMember({ ...base, userId: staff.id, roleId: employee.id });
    assert("P5 giving them Employee afterwards takes the manager level away again", (await people.listPeople(ws.id, owner.id)).find((p) => p.userId === staff.id)?.level === "member" && (await roles.getMemberRole(ws.id, staff.id))?.name === "Employee");
    assert("P6 nobody changes their own role; the owner and workspace admins keep their level; an unknown role / a stranger is refused", (await throws(() => roles.assignRoleToMember({ ...base, userId: owner.id, roleId: employee.id }))) === "not_yourself" && (await throws(() => roles.assignRoleToMember({ workspaceId: ws.id, actorUserId: admin2.id, userId: owner.id, roleId: employee.id }))) === "protected_member" && (await throws(() => roles.assignRoleToMember({ ...base, userId: admin2.id, roleId: employee.id }))) === "protected_member" && (await throws(() => roles.assignRoleToMember({ ...base, userId: staff.id, roleId: "no-such" }))) === "role_not_found" && (await throws(() => roles.assignRoleToMember({ ...base, userId: stranger.id, roleId: employee.id }))) === "not_found");
    assert("P7 giving a role is in the audit log", (await prisma.auditLog.count({ where: { workspaceId: ws.id, action: "role.assign" } })) === 2);
    delete process.env.SYNCBIZ_ROLES;
    assert("P8 with roles off the list still works and shows no role names", (await people.listPeople(ws.id, owner.id)).every((p) => p.roleName === null) && (await people.listPeople(ws.id, owner.id)).length === 5);
  } finally {
    await prisma.auditLog.deleteMany({ where: { workspaceId: { in: [ws.id, other.id] } } });
    await prisma.workspaceMemberRole.deleteMany({ where: { workspaceId: { in: [ws.id, other.id] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [ws.id, other.id] } } }).catch((e) => console.error("cleanup workspace failed", e instanceof Error ? e.message : e));
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${tag}@example.test` } } }).catch((e) => console.error("cleanup users failed", e instanceof Error ? e.message : e));
    await prisma.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
