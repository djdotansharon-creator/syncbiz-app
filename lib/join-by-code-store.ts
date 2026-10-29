import "server-only";

/**
 * Join a business by a one-time code — the database side (docs/ACCOUNTS_JOIN_DESIGN.md). The rules live in `lib/join-by-code.ts` (pure).
 * DORMANT unless the env flag SYNCBIZ_JOIN_BY_CODE=1: with the flag off nothing below is reached by any route, so a database that has not been migrated yet is never queried for these tables.
 * Sign-in is untouched: a NEW person has no User row until an admin approves (the request holds the details and the password hash), so a pending person simply cannot sign in yet.
 */

import { prisma } from "@/lib/prisma";
import { validateCredentialsAsync } from "@/lib/auth";
import { hashPassword } from "@/lib/password-utils";
import { attemptKeys, blockedFor, recordFailure, recordSuccess } from "@/lib/auth-rate-limit";
import { emitEvent, EVENT_TYPES } from "@/lib/analytics-boundary";
import { enforceCanAddWorkspaceMember } from "@/lib/entitlement-limits";
import { inviteExistingUserToWorkspace } from "@/lib/user-store";
import { isRolesEnvEnabled, tenantRoleForRole } from "@/lib/roles";
import { assignMemberRole, getRoleInWorkspace } from "@/lib/roles-store";
import { writeTenantAuditLog } from "@/lib/admin/tenant-audit";
import {
  MAX_ACTIVE_CODES,
  effectiveJoinStatus,
  formatJoinCode,
  generateJoinCode,
  hashJoinCode,
  joinCodeExpiresAt,
  joinRequestExpiresAt,
  normalizeJoinCode,
  parseJoinRole,
  tenantRoleForJoinRole,
  validateJoinInput,
  type JoinInput,
  type JoinRole,
} from "@/lib/join-by-code";

export class JoinError extends Error {
  constructor(public code: string, public httpStatus: number, message?: string) {
    super(message ?? code);
  }
}

/** A new one-time code for this workspace. The plain code is returned ONCE (only its hash is stored). */
export async function createJoinCode(params: { workspaceId: string; actorUserId: string; ip?: string | null }): Promise<{ code: string; expiresAt: string }> {
  const now = new Date();
  // tidy: codes that are used or long expired are of no use to anybody
  await prisma.workspaceJoinCode.deleteMany({
    where: { workspaceId: params.workspaceId, OR: [{ usedAt: { not: null } }, { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } }] },
  });
  const active = await prisma.workspaceJoinCode.count({ where: { workspaceId: params.workspaceId, usedAt: null, expiresAt: { gt: now } } });
  if (active >= MAX_ACTIVE_CODES) throw new JoinError("too_many_codes", 429);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateJoinCode();
    const expiresAt = joinCodeExpiresAt(now.getTime());
    try {
      await prisma.workspaceJoinCode.create({
        data: { workspaceId: params.workspaceId, codeHash: hashJoinCode(code), createdByUserId: params.actorUserId, expiresAt },
      });
      await writeTenantAuditLog(prisma, { action: "join.code_create", actorUserId: params.actorUserId, workspaceId: params.workspaceId, targetUserId: params.actorUserId, entity: "workspace", ipAddress: params.ip ?? null });
      return { code: formatJoinCode(code), expiresAt: expiresAt.toISOString() };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") continue; // the (astronomically rare) hash collision: draw again
      throw e;
    }
  }
  throw new JoinError("code_generation_failed", 500);
}

/**
 * A person typed a code: check it, then record the request and use the code up (one code = one request). Public — no session.
 * A person who already has an account must give that account's password (the request then points at it); a new person's password is stored hashed on the request only.
 */
export async function submitJoinRequest(input: JoinInput, headers: Headers): Promise<{ ok: true; hasAccount: boolean }> {
  const bad = validateJoinInput(input);
  if (bad) throw new JoinError(bad, 400);
  const email = input.email.trim().toLowerCase();
  const keys = attemptKeys("join", email, headers);
  if (blockedFor(keys) > 0) throw new JoinError("rate_limited", 429);

  const fail = (code: string, status: number): never => {
    keys.forEach((k) => recordFailure(k));
    throw new JoinError(code, status);
  };

  const now = new Date();
  const codeRow = await prisma.workspaceJoinCode.findUnique({ where: { codeHash: hashJoinCode(normalizeJoinCode(input.code)) } });
  // one answer for "no such code", "already used" and "expired": nothing for a guesser to learn from
  if (!codeRow || codeRow.usedAt || codeRow.expiresAt <= now) return fail("bad_code", 400);
  const workspaceId = codeRow.workspaceId;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
  if (existing) {
    if (!(await validateCredentialsAsync(email, input.password))) return fail("wrong_password", 401);
    const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: existing.id } }, select: { id: true } });
    if (member) throw new JoinError("already_member", 409);
  }

  const pending = await prisma.workspaceJoinRequest.findFirst({ where: { workspaceId, email, status: "pending", expiresAt: { gt: now } }, select: { id: true } });
  if (pending) throw new JoinError("already_pending", 409);

  await prisma.$transaction(async (tx) => {
    // the code is used up atomically: two people typing the same code at once cannot both get in
    const used = await tx.workspaceJoinCode.updateMany({ where: { id: codeRow.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) throw new JoinError("bad_code", 400);
    await tx.workspaceJoinRequest.create({
      data: {
        workspaceId,
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: input.phone.trim(),
        userId: existing?.id ?? null,
        passwordHash: existing ? null : hashPassword(input.password),
        expiresAt: joinRequestExpiresAt(now.getTime()),
      },
    });
  });
  keys.forEach((k) => recordSuccess(k));
  return { ok: true, hasAccount: Boolean(existing) };
}

export type JoinRequestView = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  /** true = the person already has a VONO account (they proved their password); false = a new account is created on approval */
  hasAccount: boolean;
  requestedAt: string;
  expiresAt: string;
};

export async function listJoinRequests(workspaceId: string): Promise<JoinRequestView[]> {
  const rows = await prisma.workspaceJoinRequest.findMany({ where: { workspaceId, status: "pending", expiresAt: { gt: new Date() } }, orderBy: { requestedAt: "asc" }, take: 100 });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone,
    hasAccount: r.userId !== null,
    requestedAt: r.requestedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }));
}

export async function countPendingJoinRequests(workspaceId: string): Promise<number> {
  return prisma.workspaceJoinRequest.count({ where: { workspaceId, status: "pending", expiresAt: { gt: new Date() } } });
}

/** An admin's decision. Approve = the person becomes a member with the chosen role (an account is made first when they are new); reject = the request is closed and the stored password hash dropped. */
export async function decideJoinRequest(params: {
  workspaceId: string;
  requestId: string;
  actorUserId: string;
  decision: "approve" | "reject";
  role?: unknown;
  /** with roles on (SYNCBIZ_ROLES=1): the role the owner defined — it decides the platform role and the switches; without it `role` (Manager / Member) is used as before */
  roleId?: unknown;
  ip?: string | null;
}): Promise<{ ok: true; email: string }> {
  const row = await prisma.workspaceJoinRequest.findFirst({ where: { id: params.requestId, workspaceId: params.workspaceId } });
  if (!row) throw new JoinError("not_found", 404);
  if (effectiveJoinStatus(row) !== "pending") throw new JoinError("not_pending", 409);
  const now = new Date();

  if (params.decision === "reject") {
    await prisma.workspaceJoinRequest.update({ where: { id: row.id }, data: { status: "rejected", decidedByUserId: params.actorUserId, decidedAt: now, passwordHash: null } });
    await writeTenantAuditLog(prisma, { action: "join.reject", actorUserId: params.actorUserId, workspaceId: params.workspaceId, targetUserId: row.userId ?? params.actorUserId, ipAddress: params.ip ?? null, metadata: { email: row.email } });
    return { ok: true, email: row.email };
  }

  const roleRow = typeof params.roleId === "string" && params.roleId && isRolesEnvEnabled() ? await getRoleInWorkspace(params.workspaceId, params.roleId) : null;
  if (typeof params.roleId === "string" && params.roleId && isRolesEnvEnabled() && !roleRow) throw new JoinError("role_not_found", 400);
  const role: JoinRole | null = roleRow ? (roleRow.openControlRoom ? "MANAGER" : "MEMBER") : parseJoinRole(params.role);
  if (!role) throw new JoinError("role_required", 400);
  // check the seat BEFORE making an account, so a full workspace leaves nothing behind
  await enforceCanAddWorkspaceMember(params.workspaceId);

  let user = row.userId ? await prisma.user.findUnique({ where: { id: row.userId } }) : await prisma.user.findUnique({ where: { email: row.email } });
  let created = false;
  if (!user) {
    if (!row.passwordHash) throw new JoinError("not_found", 404);
    user = await prisma.user.create({
      data: {
        email: row.email,
        name: `${row.firstName} ${row.lastName}`.trim() || null,
        firstName: row.firstName,
        lastName: row.lastName,
        passwordHash: row.passwordHash,
        role: role === "MANAGER" ? "MANAGER" : "CONTROLLER",
      },
    });
    created = true;
    emitEvent(EVENT_TYPES.USER_CREATED, { userId: user.id, email: row.email });
  }
  try {
    await inviteExistingUserToWorkspace({ email: row.email, tenantId: params.workspaceId, tenantRole: roleRow ? tenantRoleForRole(roleRow) : tenantRoleForJoinRole(role), branchAssignments: [] });
  } catch (e) {
    if (created) await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined); // leave nothing half-made
    throw e;
  }
  if (roleRow) await assignMemberRole(params.workspaceId, user.id, roleRow.id);
  await prisma.workspaceJoinRequest.update({ where: { id: row.id }, data: { status: "approved", approvedRole: roleRow ? roleRow.name : role, userId: user.id, decidedByUserId: params.actorUserId, decidedAt: now, passwordHash: null } });
  await writeTenantAuditLog(prisma, { action: "join.approve", actorUserId: params.actorUserId, workspaceId: params.workspaceId, targetUserId: user.id, ipAddress: params.ip ?? null, metadata: { email: row.email, role: roleRow ? roleRow.name : role, newAccount: created } });
  return { ok: true, email: row.email };
}
