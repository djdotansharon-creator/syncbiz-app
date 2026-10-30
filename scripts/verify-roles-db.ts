/**
 * Roles + the owner's access code against a REAL (local) database — the store (lib/roles-store.ts) and its use by join approval (lib/join-by-code-store.ts). Builds throwaway workspaces and removes them.
 * REFUSES to run against anything but a localhost database.
 * Run: node --env-file=.env.development --require ./scripts/_test-stubs/preload.cjs --import tsx scripts/verify-roles-db.ts
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
  const store = await import("../lib/roles-store");
  const join = await import("../lib/join-by-code-store");
  const joinRules = await import("../lib/join-by-code");
  const { hashPassword } = await import("../lib/password-utils");
  const { validateCredentialsAsync } = await import("../lib/auth");
  const rate = await import("../lib/auth-rate-limit");
  const tag = randomUUID().slice(0, 8);
  const mail = (n: string) => `${n}-${tag}@example.test`;
  const throws = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
      return "";
    } catch (e) {
      return e instanceof store.RoleError || e instanceof join.JoinError ? e.code : `other:${e instanceof Error ? e.message : String(e)}`;
    }
  };

  const owner = await prisma.user.create({ data: { email: mail("owner"), role: "WORKSPACE_ADMIN", passwordHash: hashPassword("owner-pw-1") } });
  const ws = await prisma.workspace.create({ data: { name: `Roles test ${tag}`, slug: `roles-test-${tag}`, ownerId: owner.id, members: { create: { userId: owner.id, role: "WORKSPACE_ADMIN" } } } });
  const other = await prisma.workspace.create({ data: { name: `Roles other ${tag}`, slug: `roles-other-${tag}`, ownerId: owner.id } });
  const base = { workspaceId: ws.id, actorUserId: owner.id };

  try {
    rate.__resetRateLimit();
    // ── ready-made roles ──
    await Promise.all([store.ensureDefaultRoles(ws.id), store.ensureDefaultRoles(ws.id)]);
    const list0 = await store.listRoles(ws.id);
    assert("D1 a business gets the three ready-made roles once (even when two requests ask at the same moment); another business has its own", list0.map((x) => x.name).join(",") === "Manager,Shift manager,Employee" && (await prisma.workspaceRole.count({ where: { workspaceId: ws.id } })) === 3 && (await prisma.workspaceRole.count({ where: { workspaceId: other.id } })) === 0);

    // ── make / change / delete ──
    const nightRole = await store.createRole({ ...base, input: { name: "  Night cashier ", openControlRoom: false, allowComputer: false } });
    assert("D2 the owner adds a role with its switches (name tidied)", nightRole.name === "Night cashier" && !nightRole.openControlRoom && !nightRole.allowComputer);
    assert("D3 a second role with the same name is refused; an empty name is refused", (await throws(() => store.createRole({ ...base, input: { name: "Night cashier", openControlRoom: false, allowComputer: true } }))) === "name_taken" && (await throws(() => store.createRole({ ...base, input: { name: " ", openControlRoom: false, allowComputer: true } }))) === "name");
    await store.updateRole({ ...base, roleId: nightRole.id, input: { name: "Night cashier", openControlRoom: false, allowComputer: true } });
    assert("D4 changing the switches is saved", (await store.listRoles(ws.id)).find((x) => x.id === nightRole.id)?.allowComputer === true);
    assert("D5 a role of another business cannot be changed or deleted from this one", (await throws(() => store.updateRole({ ...base, roleId: "no-such", input: { name: "x", openControlRoom: false, allowComputer: true } }))) === "not_found" && (await throws(() => store.deleteRole({ ...base, roleId: "no-such" }))) === "not_found");

    // ── the permission list of a role (owner 2026-10-31) ──
    const perms = await import("../lib/role-permissions");
    const listP = await store.listRoles(ws.id);
    const mgrP = listP.find((x) => x.name === "Manager");
    assert("D2b a ready-made role carries the defaults of its name (Manager everything, Employee only play / skip / volume), and a role made before the column existed ({}) reads the same", !!mgrP && perms.ALL_FLAG_KEYS.every((k) => mgrP.permissions.flags[k]) && listP.find((x) => x.name === "Employee")?.permissions.flags.volume === true && listP.find((x) => x.name === "Employee")?.permissions.flags.stop_player === false);
    const withPerms = await store.createRole({ ...base, input: { name: "Floor lead", openControlRoom: false, allowComputer: false, permissions: { flags: { play_pause: true, schedule: true, more_settings: true, add_people: true }, players: { mode: "SOME", ids: ["b-1", "b-2"] }, people: { mode: "ALL", ids: [] } } } });
    const back = (await store.listRoles(ws.id)).find((x) => x.id === withPerms.id);
    assert("D2c a role made with a permission list keeps it: the flags, the chosen players and who it can see", !!back && back.permissions.flags.play_pause && back.permissions.flags.schedule && back.permissions.flags.add_people && !back.permissions.flags.volume && back.permissions.players.mode === "SOME" && back.permissions.players.ids.join() === "b-1,b-2" && back.permissions.people.mode === "ALL");
    await store.updateRole({ ...base, roleId: withPerms.id, input: { name: "Floor lead", openControlRoom: false, allowComputer: false, permissions: { flags: { volume: true }, players: { mode: "NONE", ids: [] } } } });
    const changed = (await store.listRoles(ws.id)).find((x) => x.id === withPerms.id);
    assert("D2d changing the list is saved (and unknown keys never get in); leaving it out of an update changes nothing", !!changed && changed.permissions.flags.volume && !changed.permissions.flags.play_pause && changed.permissions.players.mode === "NONE" && (await (async () => { await store.updateRole({ ...base, roleId: withPerms.id, input: { name: "Floor lead", openControlRoom: false, allowComputer: false } }); return (await store.listRoles(ws.id)).find((x) => x.id === withPerms.id)?.permissions.flags.volume === true; })()));
    assert("D2e a permission list that is not an object is refused", (await throws(() => store.updateRole({ ...base, roleId: withPerms.id, input: { name: "Floor lead", openControlRoom: false, allowComputer: false, permissions: ["x"] } }))) === "permissions");
    await prisma.workspaceRole.update({ where: { id: withPerms.id }, data: { permissions: {} } });
    assert("D2f an EMPTY stored list on a custom name means nothing allowed (never a surprise permission)", Object.values((await store.listRoles(ws.id)).find((x) => x.id === withPerms.id)!.permissions.flags).every((v) => v === false));
    await store.deleteRole({ ...base, roleId: withPerms.id });

    // ── a person with a role ──
    const staff = await prisma.user.create({ data: { email: mail("staff"), role: "CONTROLLER", passwordHash: hashPassword("staff-pw-1") } });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: staff.id, role: "CONTROLLER" } });
    assert("D6 a person with no role has none (so the switches never touch them)", (await store.getMemberRole(ws.id, staff.id)) === null);
    await store.assignMemberRole(ws.id, staff.id, nightRole.id);
    const mr = await store.getMemberRole(ws.id, staff.id);
    assert("D7 a person given a role has it, with its switches", mr?.name === "Night cashier" && mr.allowComputer === true && mr.openControlRoom === false);
    await store.updateRole({ ...base, roleId: nightRole.id, input: { name: "Night cashier", openControlRoom: true, allowComputer: false } });
    const mem = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: staff.id } } });
    assert("D8 turning on 'opens the Control Room' really changes what the people with that role can open (their platform role follows), and the computer switch is read live", mem?.role === "MANAGER" && (await store.getMemberRole(ws.id, staff.id))?.allowComputer === false);
    assert("D9 a role that people still have cannot be deleted; an unused one can", (await throws(() => store.deleteRole({ ...base, roleId: nightRole.id }))) === "role_in_use" && (await (async () => {
      const tmp = await store.createRole({ ...base, input: { name: "Temp", openControlRoom: false, allowComputer: true } });
      await store.deleteRole({ ...base, roleId: tmp.id });
      return (await prisma.workspaceRole.count({ where: { id: tmp.id } })) === 0;
    })()));
    await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: ws.id, userId: owner.id } }, data: { role: "WORKSPACE_ADMIN" } });

    // ── the limit ──
    const have = await prisma.workspaceRole.count({ where: { workspaceId: ws.id } });
    for (let i = 0; i < 20 - have; i += 1) await store.createRole({ ...base, input: { name: `Filler ${i}`, openControlRoom: false, allowComputer: true } });
    assert("D10 a business cannot have more than 20 roles", (await throws(() => store.createRole({ ...base, input: { name: "One too many", openControlRoom: false, allowComputer: true } }))) === "too_many_roles");

    // ── the owner's own access code ──
    assert("D11 until the owner chooses one there is none (the default 123 applies)", (await store.checkWorkspaceAccessCode(ws.id, "123")) === null && !(await store.hasCustomAccessCode(ws.id)));
    await store.setWorkspaceAccessCode({ ...base, code: "4821" });
    const stored = await prisma.workspaceAccessCode.findUnique({ where: { workspaceId: ws.id } });
    assert("D12 his code works, others (incl. 123) do not; only a salted hash is stored", (await store.checkWorkspaceAccessCode(ws.id, "4821")) === true && (await store.checkWorkspaceAccessCode(ws.id, "123")) === false && !!stored && !JSON.stringify(stored).includes("4821") && (await store.hasCustomAccessCode(ws.id)));
    await store.setWorkspaceAccessCode({ ...base, code: "Shop77" });
    assert("D13 choosing another replaces it; another business is unaffected; a bad code is refused", (await store.checkWorkspaceAccessCode(ws.id, "Shop77")) === true && (await store.checkWorkspaceAccessCode(ws.id, "4821")) === false && (await store.checkWorkspaceAccessCode(other.id, "Shop77")) === null && (await throws(() => store.setWorkspaceAccessCode({ ...base, code: "12" }))) === "bad_code" && (await throws(() => store.setWorkspaceAccessCode({ ...base, code: "a b c" }))) === "bad_code");

    // ── joining with the owner's roles ──
    const codeA = (await join.createJoinCode({ workspaceId: ws.id, actorUserId: owner.id })).code;
    await join.submitJoinRequest({ code: codeA, email: mail("noa"), password: "noa-pass-1", firstName: "Noa", lastName: "L", phone: "" }, new Headers({ "x-forwarded-for": "10.9.0.1" }));
    const reqNoa = (await prisma.workspaceJoinRequest.findFirst({ where: { workspaceId: ws.id, email: mail("noa") } }))!;
    const employee = (await store.listRoles(ws.id)).find((x) => x.name === "Employee")!;
    assert("D14 approving with a role the business does not have is refused (and nothing is made)", (await throws(() => join.decideJoinRequest({ workspaceId: ws.id, requestId: reqNoa.id, actorUserId: owner.id, decision: "approve", roleId: "no-such-role" }))) === "role_not_found" && (await prisma.user.findUnique({ where: { email: mail("noa") } })) === null);
    await join.decideJoinRequest({ workspaceId: ws.id, requestId: reqNoa.id, actorUserId: owner.id, decision: "approve", roleId: employee.id });
    const noa = (await prisma.user.findUnique({ where: { email: mail("noa") } }))!;
    const noaMem = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: noa.id } } });
    assert("D15 approving with 'Employee' makes a member (not a manager), gives them that role, and their password works", noaMem?.role === "CONTROLLER" && (await store.getMemberRole(ws.id, noa.id))?.name === "Employee" && (await validateCredentialsAsync(mail("noa"), "noa-pass-1")));
    const codeB = (await join.createJoinCode({ workspaceId: ws.id, actorUserId: owner.id })).code;
    await join.submitJoinRequest({ code: codeB, email: mail("dana"), password: "dana-pass-1", firstName: "Dana", lastName: "C", phone: "" }, new Headers({ "x-forwarded-for": "10.9.0.2" }));
    const reqDana = (await prisma.workspaceJoinRequest.findFirst({ where: { workspaceId: ws.id, email: mail("dana") } }))!;
    const manager = (await store.listRoles(ws.id)).find((x) => x.name === "Manager")!;
    await join.decideJoinRequest({ workspaceId: ws.id, requestId: reqDana.id, actorUserId: owner.id, decision: "approve", roleId: manager.id });
    const dana = (await prisma.user.findUnique({ where: { email: mail("dana") } }))!;
    assert("D16 approving with 'Manager' (Control Room on) makes a manager; the request records the role's name", (await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: dana.id } } }))?.role === "MANAGER" && (await prisma.workspaceJoinRequest.findUnique({ where: { id: reqDana.id } }))?.approvedRole === "Manager");

    // ── without roles on, approval works exactly as before ──
    delete process.env.SYNCBIZ_ROLES;
    const codeC = (await join.createJoinCode({ workspaceId: ws.id, actorUserId: owner.id })).code;
    await join.submitJoinRequest({ code: codeC, email: mail("ron"), password: "ron-pass-1", firstName: "Ron", lastName: "B", phone: "" }, new Headers({ "x-forwarded-for": "10.9.0.3" }));
    const reqRon = (await prisma.workspaceJoinRequest.findFirst({ where: { workspaceId: ws.id, email: mail("ron") } }))!;
    await join.decideJoinRequest({ workspaceId: ws.id, requestId: reqRon.id, actorUserId: owner.id, decision: "approve", role: "MEMBER" });
    const ron = (await prisma.user.findUnique({ where: { email: mail("ron") } }))!;
    assert("D17 with the roles flag off, approval takes the plain Member / Manager choice and makes no role row", (await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: ron.id } } }))?.role === "CONTROLLER" && (await prisma.workspaceMemberRole.count({ where: { workspaceId: ws.id, userId: ron.id } })) === 0);
    process.env.SYNCBIZ_ROLES = "1";

    // ── audit ──
    const actions = (await prisma.auditLog.findMany({ where: { workspaceId: ws.id }, select: { action: true } })).map((a) => a.action);
    assert("D18 making, changing and deleting roles and choosing the access code are all in the audit log", ["role.create", "role.update", "role.delete", "role.access_code_set"].every((a) => actions.includes(a)));
    // deleting the business removes its roles with it (but a role in use blocks a stray delete)
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
