import "server-only";

/**
 * Roles with switches + the owner's own access code — the database side (docs/ROLES_DESIGN.md). The rules live in `lib/roles.ts` (pure).
 * DORMANT unless SYNCBIZ_ROLES=1: no route reaches this file with the flag off, so a database that has not been migrated yet is never queried for these tables.
 */

import { prisma } from "@/lib/prisma";
import { writeTenantAuditLog } from "@/lib/admin/tenant-audit";
import { defaultPermissionsFor, emptyPermissions, normalizePermissions, validatePermissionsInput, type RolePermissions } from "@/lib/role-permissions";
import { DEFAULT_ROLES, MAX_ROLES_PER_WORKSPACE, accessCodeMatches, hashAccessCode, validateAccessCode, validateRoleInput } from "@/lib/roles";

export class RoleError extends Error {
  constructor(public code: string, public httpStatus: number, message?: string) {
    super(message ?? code);
  }
}

export type RoleView = { id: string; name: string; openControlRoom: boolean; allowComputer: boolean; permissions: RolePermissions; members: number };

/** A business that has no roles yet gets the ready-made three (safe to call every time; concurrent first calls end with one set). */
export async function ensureDefaultRoles(workspaceId: string): Promise<void> {
  if ((await prisma.workspaceRole.count({ where: { workspaceId } })) > 0) return;
  await prisma.workspaceRole.createMany({ data: DEFAULT_ROLES.map((r) => ({ workspaceId, name: r.name, openControlRoom: r.openControlRoom, allowComputer: r.allowComputer, permissions: defaultPermissionsFor(r.name), sortOrder: r.sortOrder })), skipDuplicates: true });
}

export async function listRoles(workspaceId: string): Promise<RoleView[]> {
  await ensureDefaultRoles(workspaceId);
  const rows = await prisma.workspaceRole.findMany({ where: { workspaceId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { members: true } } } });
  return rows.map((r) => ({ id: r.id, name: r.name, openControlRoom: r.openControlRoom, allowComputer: r.allowComputer, permissions: normalizePermissions(r.permissions, r.name), members: r._count.members }));
}

export async function hasCustomAccessCode(workspaceId: string): Promise<boolean> {
  return (await prisma.workspaceAccessCode.count({ where: { workspaceId } })) > 0;
}

export async function createRole(params: { workspaceId: string; actorUserId: string; input: { name: unknown; openControlRoom: unknown; allowComputer: unknown; permissions?: unknown } }): Promise<RoleView> {
  const v = validateRoleInput(params.input);
  if (!v.ok) throw new RoleError(v.error, 400);
  if (!validatePermissionsInput(params.input.permissions).ok) throw new RoleError("permissions", 400);
  const permissions = params.input.permissions === undefined ? emptyPermissions(v.value.name) : normalizePermissions(params.input.permissions, v.value.name);
  await ensureDefaultRoles(params.workspaceId);
  if ((await prisma.workspaceRole.count({ where: { workspaceId: params.workspaceId } })) >= MAX_ROLES_PER_WORKSPACE) throw new RoleError("too_many_roles", 409);
  try {
    const last = await prisma.workspaceRole.findFirst({ where: { workspaceId: params.workspaceId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const row = await prisma.workspaceRole.create({ data: { workspaceId: params.workspaceId, ...v.value, permissions, sortOrder: (last?.sortOrder ?? 0) + 1 } });
    await writeTenantAuditLog(prisma, { action: "role.create", actorUserId: params.actorUserId, workspaceId: params.workspaceId, targetUserId: params.actorUserId, entity: "workspace", metadata: { roleId: row.id, name: row.name } });
    return { id: row.id, name: row.name, openControlRoom: row.openControlRoom, allowComputer: row.allowComputer, permissions, members: 0 };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new RoleError("name_taken", 409);
    throw e;
  }
}

export async function updateRole(params: { workspaceId: string; actorUserId: string; roleId: string; input: { name: unknown; openControlRoom: unknown; allowComputer: unknown; permissions?: unknown } }): Promise<void> {
  const v = validateRoleInput(params.input);
  if (!v.ok) throw new RoleError(v.error, 400);
  if (!validatePermissionsInput(params.input.permissions).ok) throw new RoleError("permissions", 400);
  const row = await prisma.workspaceRole.findFirst({ where: { id: params.roleId, workspaceId: params.workspaceId }, select: { id: true } });
  if (!row) throw new RoleError("not_found", 404);
  try {
    await prisma.workspaceRole.update({ where: { id: row.id }, data: { ...v.value, ...(params.input.permissions !== undefined ? { permissions: normalizePermissions(params.input.permissions, v.value.name) } : {}) } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new RoleError("name_taken", 409);
    throw e;
  }
  // the platform role of people who already have this role follows the Control Room switch (so changing the switch really changes what they can open)
  const members = await prisma.workspaceMemberRole.findMany({ where: { workspaceId: params.workspaceId, roleId: row.id }, select: { userId: true } });
  if (members.length > 0) {
    const prismaRole = v.value.openControlRoom ? "MANAGER" : "CONTROLLER";
    await prisma.workspaceMember.updateMany({ where: { workspaceId: params.workspaceId, userId: { in: members.map((m) => m.userId) }, role: { in: ["MANAGER", "CONTROLLER"] } }, data: { role: prismaRole } });
  }
  await writeTenantAuditLog(prisma, { action: "role.update", actorUserId: params.actorUserId, workspaceId: params.workspaceId, targetUserId: params.actorUserId, entity: "workspace", metadata: { roleId: row.id, ...v.value } });
}

export async function deleteRole(params: { workspaceId: string; actorUserId: string; roleId: string }): Promise<void> {
  const row = await prisma.workspaceRole.findFirst({ where: { id: params.roleId, workspaceId: params.workspaceId }, include: { _count: { select: { members: true } } } });
  if (!row) throw new RoleError("not_found", 404);
  if (row._count.members > 0) throw new RoleError("role_in_use", 409);
  await prisma.workspaceRole.delete({ where: { id: row.id } });
  await writeTenantAuditLog(prisma, { action: "role.delete", actorUserId: params.actorUserId, workspaceId: params.workspaceId, targetUserId: params.actorUserId, entity: "workspace", metadata: { roleId: row.id, name: row.name } });
}

export async function getRoleInWorkspace(workspaceId: string, roleId: string) {
  return prisma.workspaceRole.findFirst({ where: { id: roleId, workspaceId } });
}

export async function assignMemberRole(workspaceId: string, userId: string, roleId: string): Promise<void> {
  await prisma.workspaceMemberRole.upsert({ where: { workspaceId_userId: { workspaceId, userId } }, update: { roleId }, create: { workspaceId, userId, roleId } });
}

/** The role this person holds in this business, if any (people given no role are never affected by the switches). */
export async function getMemberRole(workspaceId: string, userId: string): Promise<{ allowComputer: boolean; openControlRoom: boolean; name: string } | null> {
  const m = await prisma.workspaceMemberRole.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, include: { role: true } });
  return m ? { allowComputer: m.role.allowComputer, openControlRoom: m.role.openControlRoom, name: m.role.name } : null;
}

/** The owner chooses his own access code for Settings on the player computer (stored salted + hashed). */
export async function setWorkspaceAccessCode(params: { workspaceId: string; actorUserId: string; code: unknown }): Promise<void> {
  const v = validateAccessCode(params.code);
  if (!v.ok) throw new RoleError("bad_code", 400);
  const { salt, hash } = hashAccessCode(v.value);
  await prisma.workspaceAccessCode.upsert({ where: { workspaceId: params.workspaceId }, update: { codeHash: hash, codeSalt: salt }, create: { workspaceId: params.workspaceId, codeHash: hash, codeSalt: salt } });
  await writeTenantAuditLog(prisma, { action: "role.access_code_set", actorUserId: params.actorUserId, workspaceId: params.workspaceId, targetUserId: params.actorUserId, entity: "workspace" });
}

/** null = the owner has not chosen one (the default 123 / env code applies); true / false = does this code match HIS code. */
export async function checkWorkspaceAccessCode(workspaceId: string, code: string): Promise<boolean | null> {
  const row = await prisma.workspaceAccessCode.findUnique({ where: { workspaceId } });
  if (!row) return null;
  return accessCodeMatches(code, row.codeSalt, row.codeHash);
}

/**
 * Give an EXISTING member another of the owner's roles (owner 2026-10-29: "click a person and set their permissions"). The platform level follows the role's Control Room switch — but only for plain
 * managers / members: the workspace owner and workspace admins are never changed here (they could lock the business out of itself), and nobody changes their own role.
 */
export async function assignRoleToMember(params: { workspaceId: string; actorUserId: string; userId: string; roleId: string }): Promise<void> {
  if (params.userId === params.actorUserId) throw new RoleError("not_yourself", 409);
  const role = await getRoleInWorkspace(params.workspaceId, params.roleId);
  if (!role) throw new RoleError("role_not_found", 400);
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: params.workspaceId, userId: params.userId } }, select: { role: true } });
  if (!member) throw new RoleError("not_found", 404);
  const ws = await prisma.workspace.findUnique({ where: { id: params.workspaceId }, select: { ownerId: true } });
  if (ws?.ownerId === params.userId || member.role === "WORKSPACE_ADMIN") throw new RoleError("protected_member", 409);
  await assignMemberRole(params.workspaceId, params.userId, role.id);
  await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: params.workspaceId, userId: params.userId } }, data: { role: role.openControlRoom ? "MANAGER" : "CONTROLLER" } });
  await writeTenantAuditLog(prisma, { action: "role.assign", actorUserId: params.actorUserId, workspaceId: params.workspaceId, targetUserId: params.userId, metadata: { roleId: role.id, name: role.name } });
}
