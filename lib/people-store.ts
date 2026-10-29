import "server-only";

/**
 * "People" of a business for the Permissions screen (owner 2026-10-29: "in the permissions area they will see all the people, their state and name; I click and can set the person's
 * permissions, see their level and their details"). Reads only EXISTING tables (users, memberships); the custom role name is added only when roles are on (SYNCBIZ_ROLES=1) and never fails the list.
 */

import { prisma } from "@/lib/prisma";
import { isRolesEnvEnabled } from "@/lib/roles";

export type PersonView = {
  userId: string;
  name: string;
  email: string;
  /** the platform level: owner / manager / member */
  level: "owner" | "manager" | "member";
  /** the role the owner gave (roles on) */
  roleId: string | null;
  roleName: string | null;
  /** active = may sign in; paused = suspended in this business; disabled = login switched off */
  status: "active" | "paused" | "disabled";
  lastSignInAt: string | null;
  joinedAt: string;
  isYou: boolean;
};

export async function listPeople(workspaceId: string, actorUserId: string): Promise<PersonView[]> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } });
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } } }, orderBy: { createdAt: "asc" } });
  const roleOf = new Map<string, { id: string; name: string }>();
  if (isRolesEnvEnabled()) {
    try {
      const rows = await prisma.workspaceMemberRole.findMany({ where: { workspaceId }, include: { role: { select: { id: true, name: true } } } });
      rows.forEach((r) => roleOf.set(r.userId, { id: r.role.id, name: r.role.name }));
    } catch (e) {
      console.error("[people] role names unavailable — listing without them", e instanceof Error ? e.message : String(e));
    }
  }
  return members.map((m) => {
    const level: PersonView["level"] = ws?.ownerId === m.userId ? "owner" : m.role === "WORKSPACE_ADMIN" || m.role === "MANAGER" ? "manager" : "member";
    const custom = roleOf.get(m.userId) ?? null;
    return {
      userId: m.userId,
      name: (m.user.name ?? "").trim() || m.user.email.split("@")[0],
      email: m.user.email,
      level,
      roleId: custom?.id ?? null,
      roleName: custom?.name ?? null,
      status: m.user.status === "DISABLED" ? "disabled" : m.status === "SUSPENDED" ? "paused" : "active",
      lastSignInAt: m.user.lastLoginAt ? m.user.lastLoginAt.toISOString() : null,
      joinedAt: m.createdAt.toISOString(),
      isYou: m.userId === actorUserId,
    };
  });
}
