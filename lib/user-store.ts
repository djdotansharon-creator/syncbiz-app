/**
 * User store — backed by PostgreSQL via Prisma.
 * Replaces the previous file-based (JSON) implementation.
 * All function signatures are preserved for drop-in compatibility.
 * user.tenantId is now the Workspace UUID (previously a legacy string ID).
 */

import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { hashPassword } from "./password-utils";
import { emitEvent, EVENT_TYPES } from "./analytics-boundary";
import type { User, Tenant, Membership, UserBranchAssignment, TenantRole, BranchRole, AccessType } from "./user-types";

const DEFAULT_BRANCH_ID = "default";
const ALL_BRANCHES_SENTINEL = "*";

/** Sentinel meaning user can access all branches (OWNER). */
export const ALL_BRANCHES_SENTINEL_EXPORT = ALL_BRANCHES_SENTINEL;

/** Emails that receive a seeded owner account on first login. */
const LEGACY_SEED_EMAILS = ["test@syncbiz.com", "djdotansharon@gmail.com"];

/**
 * Comma-separated list of emails (from `SYNCBIZ_OWNER_EMAILS`) that are
 * platform owners — i.e. get `UserRole.SUPER_ADMIN` on login, which unlocks
 * the `/admin` owner CRM. Empty/unset → no automatic promotions.
 *
 * Intentionally env-driven so DB resets / new environments don't lose
 * ownership, and so we never need to hand-edit `User.role` again.
 */
function ownerEmailSet(): Set<string> {
  const raw = process.env.SYNCBIZ_OWNER_EMAILS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function ensurePlatformOwnerRole(userId: string, email: string): Promise<void> {
  if (!ownerEmailSet().has(email)) return;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!row || row.role === "SUPER_ADMIN") return;
  await prisma.user.update({
    where: { id: userId },
    data: { role: "SUPER_ADMIN" as import("@prisma/client").UserRole },
  });
}

// ─── Role mapping helpers ─────────────────────────────────────────────────────

function prismaRoleToTenantRole(role: string): TenantRole {
  if (role === "SUPER_ADMIN" || role === "WORKSPACE_ADMIN") return "TENANT_OWNER";
  if (role === "MANAGER") return "TENANT_ADMIN";
  return "TENANT_MEMBER";
}

function tenantRoleToPrismaRole(role: TenantRole): string {
  if (role === "TENANT_OWNER") return "WORKSPACE_ADMIN";
  if (role === "TENANT_ADMIN") return "MANAGER";
  return "CONTROLLER";
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function rowToUser(
  row: { id: string; email: string; name: string | null; passwordHash: string | null; createdAt: Date; status?: string | null; deactivatedAt?: Date | null },
  workspaceId: string,
): User {
  return {
    id: row.id,
    email: row.email,
    tenantId: workspaceId,
    createdAt: row.createdAt.toISOString(),
    passwordHash: row.passwordHash ?? undefined,
    name: row.name ?? undefined,
    status: (row.status as User["status"]) ?? "ACTIVE",
    deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : undefined,
  };
}

function rowToTenant(row: { id: string; name: string; createdAt: Date }): Tenant {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── Seed workspace helper ────────────────────────────────────────────────────

async function ensureSeedWorkspace(ownerEmail: string): Promise<{ workspace: { id: string; name: string }; userId: string }> {
  // Find or create user
  let user = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: ownerEmail,
        name: ownerEmail === "djdotansharon@gmail.com" ? "Dotan Sharon" : "Test User",
        role: "WORKSPACE_ADMIN",
      },
    });
  }

  // Find existing workspace owned by this user
  const existing = await prisma.workspace.findFirst({
    where: { ownerId: user.id },
  });
  if (existing) {
    // Ensure membership exists
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: existing.id, userId: user.id } },
      update: {},
      create: { workspaceId: existing.id, userId: user.id, role: "WORKSPACE_ADMIN" },
    });
    // Ensure branch assignment exists
    await prisma.userBranchAssignment.upsert({
      where: { userId_workspaceId_branchId: { userId: user.id, workspaceId: existing.id, branchId: DEFAULT_BRANCH_ID } },
      update: {},
      create: { userId: user.id, workspaceId: existing.id, branchId: DEFAULT_BRANCH_ID, role: "BRANCH_MANAGER" },
    });
    return { workspace: existing, userId: user.id };
  }

  // Create new workspace
  const slug = `workspace-${user.id.slice(0, 8)}`;
  const workspace = await prisma.workspace.create({
    data: {
      name: "SyncBiz Workspace",
      slug,
      ownerId: user.id,
      members: {
        create: { userId: user.id, role: "WORKSPACE_ADMIN" },
      },
    },
  });

  // Update user to be owner
  await prisma.user.update({
    where: { id: user.id },
    data: { role: "WORKSPACE_ADMIN" },
  });

  // Create default branch assignment
  await prisma.userBranchAssignment.create({
    data: { userId: user.id, workspaceId: workspace.id, branchId: DEFAULT_BRANCH_ID, role: "BRANCH_MANAGER" },
  });

  return { workspace, userId: user.id };
}

/**
 * Picks a single active workspace for session/auth when a user has multiple
 * `WorkspaceMember` rows. Prefer the workspace the user owns, else the oldest
 * membership. Avoids `findFirst` non-determinism and wrong-tenant access checks.
 */
async function resolvePrimaryWorkspaceMembership(userId: string) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: { select: { id: true, ownerId: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;
  const owned = memberships.find((m) => m.workspace.ownerId === userId);
  return (owned ?? memberships[0])!;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getUserByEmail(email: string): Promise<User | null> {
  const norm = email?.trim().toLowerCase();
  if (!norm) return null;
  const user = await prisma.user.findUnique({ where: { email: norm } });
  if (!user) return null;
  // Soft-disabled users are invisible to login and to current-session resolution.
  // SUPER_ADMIN cannot be soft-disabled, so this gate is safe for owner CRM access too.
  if (user.status === "DISABLED") return null;
  const membership = await resolvePrimaryWorkspaceMembership(user.id);
  if (!membership) return null;
  return rowToUser(user, membership.workspaceId);
}

export async function getOrCreateUserByEmail(email: string): Promise<User> {
  const norm = email?.trim().toLowerCase();
  if (!norm) throw new Error("Email required");
  const existing = await getUserByEmail(norm);
  if (existing) {
    await ensurePlatformOwnerRole(existing.id, norm);
    return existing;
  }
  if (!LEGACY_SEED_EMAILS.includes(norm)) throw new Error("User not found");
  const { workspace, userId } = await ensureSeedWorkspace(norm);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User seed failed");
  await ensurePlatformOwnerRole(user.id, norm);
  return rowToUser(user, workspace.id);
}

export async function getUserById(userId: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  // Mirror the gate in getUserByEmail: disabled users are not resolvable.
  if (user.status === "DISABLED") return null;
  const membership = await resolvePrimaryWorkspaceMembership(userId);
  if (!membership) return null;
  return rowToUser(user, membership.workspaceId);
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const ws = await prisma.workspace.findFirst({
    where: { OR: [{ id: tenantId }, { slug: tenantId }] },
  });
  return ws ? rowToTenant(ws) : null;
}

export async function listUsers(): Promise<User[]> {
  const users = await prisma.user.findMany();
  const result: User[] = [];
  for (const u of users) {
    const membership = await prisma.workspaceMember.findFirst({ where: { userId: u.id } });
    if (membership) {
      result.push(rowToUser({ ...u, passwordHash: null }, membership.workspaceId));
    }
  }
  return result;
}

export async function createUser(params: {
  email: string;
  password: string;
  tenantRole: TenantRole;
  branchAssignments: Array<{ branchId: string; role: BranchRole }>;
  tenantId: string;
  name?: string;
}): Promise<User> {
  const norm = params.email?.trim().toLowerCase();
  if (!norm) throw new Error("Email required");
  if (!params.password || params.password.length < 6) throw new Error("Password must be at least 6 characters");

  const existing = await prisma.user.findUnique({ where: { email: norm } });
  if (existing) throw new Error("User already exists");

  const tenantId = params.tenantId.trim();
  if (!tenantId) throw new Error("tenantId is required");

  const workspace = await prisma.workspace.findFirst({
    where: { OR: [{ id: tenantId }, { slug: tenantId }] },
  });
  if (!workspace) throw new Error("tenantId does not exist");

  const prismaRole = tenantRoleToPrismaRole(params.tenantRole);
  const user = await prisma.user.create({
    data: {
      email: norm,
      name: params.name?.trim() || null,
      passwordHash: hashPassword(params.password),
      role: prismaRole as import("@prisma/client").UserRole,
    },
  });

  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: prismaRole as import("@prisma/client").UserRole },
  });

  const rawAssignments = Array.isArray(params.branchAssignments) ? params.branchAssignments : [];
  // Empty branch list → default branch (create-then-assign flow from Access Control).
  const assignments = rawAssignments.length > 0 ? rawAssignments : [{ branchId: DEFAULT_BRANCH_ID, role: "BRANCH_CONTROLLER" as BranchRole }];

  for (const a of assignments) {
    await prisma.userBranchAssignment.upsert({
      where: { userId_workspaceId_branchId: { userId: user.id, workspaceId: workspace.id, branchId: a.branchId || DEFAULT_BRANCH_ID } },
      update: {},
      create: { userId: user.id, workspaceId: workspace.id, branchId: a.branchId || DEFAULT_BRANCH_ID, role: a.role },
    });
  }

  emitEvent(EVENT_TYPES.USER_CREATED, { userId: user.id, email: norm });
  return rowToUser({ ...user, passwordHash: null }, workspace.id);
}

export async function listUsersWithScopeForTenant(tenantId: string): Promise<
  Array<{
    id: string; email: string; tenantId: string; createdAt: string;
    name?: string; accessType: AccessType; branchIds: string[];
    status: "ACTIVE" | "PENDING" | "DISABLED";
    deactivatedAt?: string;
    /** True when this row cannot be soft-disabled (super_admin / workspace owner / last admin). */
    protected: boolean;
  }>
> {
  const workspace = await prisma.workspace.findFirst({
    where: { OR: [{ id: tenantId }, { slug: tenantId }] },
  });
  if (!workspace) return [];

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: workspace.id },
    include: { user: true },
  });

  // Pre-compute "is last WORKSPACE_ADMIN" so we don't issue N count queries.
  const adminMemberIds = members.filter((m) => m.role === "WORKSPACE_ADMIN").map((m) => m.userId);
  const onlyAdminUserId = adminMemberIds.length === 1 ? adminMemberIds[0] : null;

  return Promise.all(
    members.map(async (m) => {
      const tenantRole = prismaRoleToTenantRole(m.role);
      const accessType: AccessType = tenantRole === "TENANT_OWNER" || tenantRole === "TENANT_ADMIN" ? "OWNER" : "BRANCH_USER";
      const status = (m.user.status ?? "ACTIVE") as "ACTIVE" | "PENDING" | "DISABLED";
      const deactivatedAt = m.user.deactivatedAt ? m.user.deactivatedAt.toISOString() : undefined;
      const isSuperAdmin = m.user.role === "SUPER_ADMIN";
      const isWorkspaceOwner = workspace.ownerId === m.user.id;
      const isLastAdmin = onlyAdminUserId === m.user.id;
      const isProtected = isSuperAdmin || isWorkspaceOwner || isLastAdmin;

      const branchIds: string[] = await (async () => {
        if (accessType === "OWNER") return [];
        const assignments = await prisma.userBranchAssignment.findMany({ where: { userId: m.user.id, workspaceId: workspace.id } });
        return [...new Set(assignments.map((a) => a.branchId))].filter(Boolean);
      })();

      return {
        id: m.user.id,
        email: m.user.email,
        tenantId: workspace.id,
        createdAt: m.user.createdAt.toISOString(),
        name: m.user.name ?? undefined,
        accessType,
        branchIds,
        status,
        deactivatedAt,
        protected: isProtected,
      };
    }),
  );
}

export async function updateUser(params: {
  email: string;
  tenantId: string;
  tenantRole: TenantRole;
  name?: string;
  /** If set and length ≥ 6, replaces password hash (admin / account maintenance). */
  newPassword?: string;
  branchAssignments: Array<{ branchId: string; role: BranchRole }>;
}): Promise<User> {
  const norm = params.email?.trim().toLowerCase();
  if (!norm) throw new Error("Email required");
  const user = await prisma.user.findUnique({ where: { email: norm } });
  if (!user) throw new Error("User not found");

  const workspace = await prisma.workspace.findFirst({
    where: { OR: [{ id: params.tenantId }, { slug: params.tenantId }] },
  });
  if (!workspace) throw new Error("tenantId not found");

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  if (!membership) throw new Error("Forbidden: user not in this tenant");

  const prismaRole = tenantRoleToPrismaRole(params.tenantRole);
  const pw = typeof params.newPassword === "string" ? params.newPassword : "";
  const updatePassword = pw.length >= 6;
  if (pw.length > 0 && !updatePassword) {
    throw new Error("Password must be at least 6 characters");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: typeof params.name === "string" ? (params.name.trim() || null) : undefined,
      ...(updatePassword ? { passwordHash: hashPassword(pw) } : {}),
      // Reactivate on edit: setting a new password or otherwise editing
      // a disabled user is interpreted as the admin un-disabling them.
      ...(user.status === "DISABLED" ? { status: "ACTIVE" as const, deactivatedAt: null } : {}),
    },
  });
  await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    data: { role: prismaRole as import("@prisma/client").UserRole },
  });

  const rawAssignments = Array.isArray(params.branchAssignments) ? params.branchAssignments : [];
  const assignments = rawAssignments.length > 0 ? rawAssignments : [{ branchId: DEFAULT_BRANCH_ID, role: "BRANCH_CONTROLLER" as BranchRole }];

  await prisma.userBranchAssignment.deleteMany({ where: { userId: user.id, workspaceId: workspace.id } });
  for (const a of assignments) {
    await prisma.userBranchAssignment.create({
      data: { userId: user.id, workspaceId: workspace.id, branchId: a.branchId || DEFAULT_BRANCH_ID, role: a.role },
    });
  }

  emitEvent(EVENT_TYPES.USER_UPDATED, { userId: user.id, email: norm });
  emitEvent(EVENT_TYPES.BRANCH_ASSIGNMENT_CHANGED, { userId: user.id, email: norm });

  const updated = await prisma.user.findUnique({ where: { id: user.id } });
  return rowToUser({ ...updated!, passwordHash: null }, workspace.id);
}

export async function createWorkspaceOwner(params: {
  email: string;
  password: string;
  workspaceName: string;
  ownerName?: string;
}): Promise<{ user: User; tenant: Tenant }> {
  const norm = params.email?.trim().toLowerCase();
  if (!norm) throw new Error("Email required");
  if (!params.password || params.password.length < 6) throw new Error("Password must be at least 6 characters");

  const existing = await prisma.user.findUnique({ where: { email: norm } });
  if (existing) throw new Error("User already exists");

  const user = await prisma.user.create({
    data: {
      email: norm,
      name: params.ownerName?.trim() || null,
      passwordHash: hashPassword(params.password),
      role: "WORKSPACE_ADMIN",
    },
  });

  const slug = `ws-${user.id.slice(0, 8)}-${Date.now().toString(36)}`;
  const workspace = await prisma.workspace.create({
    data: {
      name: params.workspaceName?.trim() || "SyncBiz Workspace",
      slug,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "WORKSPACE_ADMIN" } },
    },
  });

  await prisma.userBranchAssignment.create({
    data: { userId: user.id, workspaceId: workspace.id, branchId: DEFAULT_BRANCH_ID, role: "BRANCH_MANAGER" },
  });

  return {
    user: rowToUser({ ...user, passwordHash: null }, workspace.id),
    tenant: rowToTenant(workspace),
  };
}

export async function createPasswordResetToken(email: string): Promise<string | null> {
  const norm = email?.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: norm } });
  if (!user) return null;
  // Invalidate existing tokens
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      userId: user.id,
      expiresAt,
    },
  });
  return rawToken;
}

export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<"ok" | "invalid_token" | "expired" | "weak_password"> {
  if (!newPassword || newPassword.length < 6) return "weak_password";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!rec || rec.usedAt) return "invalid_token";
  if (rec.expiresAt < new Date()) return "expired";
  await prisma.user.update({
    where: { id: rec.userId },
    data: { passwordHash: hashPassword(newPassword) },
  });
  await prisma.passwordResetToken.update({
    where: { id: rec.id },
    data: { usedAt: new Date() },
  });
  return "ok";
}

/**
 * Outcome of a soft-disable request. Discriminated union so the route can
 * map each case to a clean HTTP status without re-deriving conditions.
 */
export type DisableOutcome =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: "not_found" | "wrong_workspace" | "self" | "super_admin" | "workspace_owner" | "last_admin" };

/**
 * Soft-disable a user inside the admin's workspace.
 *
 * - Sets `User.status = DISABLED` and `User.deactivatedAt = now()`.
 * - Does NOT delete the User row.
 * - Does NOT touch WorkspaceMember or UserBranchAssignment, so the admin
 *   list keeps showing disabled users and reactivation is a single update.
 *
 * Refuses (returns `ok: false` with a reason) if:
 *   - target email does not exist
 *   - target user is not a member of `tenantId`
 *   - target is the acting admin (`actingUserId`)
 *   - target has `User.role = SUPER_ADMIN`
 *   - target is the `Workspace.ownerId` of `tenantId`
 *   - target is the last remaining `WORKSPACE_ADMIN` member of `tenantId`
 */
export async function disableUserInWorkspace(params: {
  email: string;
  tenantId: string;
  actingUserId: string;
}): Promise<DisableOutcome> {
  const norm = params.email?.trim().toLowerCase();
  if (!norm) return { ok: false, reason: "not_found" };

  const target = await prisma.user.findUnique({ where: { email: norm } });
  if (!target) return { ok: false, reason: "not_found" };

  const workspace = await prisma.workspace.findFirst({
    where: { OR: [{ id: params.tenantId }, { slug: params.tenantId }] },
  });
  if (!workspace) return { ok: false, reason: "wrong_workspace" };

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: target.id } },
  });
  if (!membership) return { ok: false, reason: "wrong_workspace" };

  if (target.id === params.actingUserId) return { ok: false, reason: "self" };
  if (target.role === "SUPER_ADMIN") return { ok: false, reason: "super_admin" };
  if (workspace.ownerId === target.id) return { ok: false, reason: "workspace_owner" };

  if (membership.role === "WORKSPACE_ADMIN") {
    const otherAdmins = await prisma.workspaceMember.count({
      where: {
        workspaceId: workspace.id,
        role: "WORKSPACE_ADMIN",
        userId: { not: target.id },
      },
    });
    if (otherAdmins === 0) return { ok: false, reason: "last_admin" };
  }

  await prisma.user.update({
    where: { id: target.id },
    data: {
      status: "DISABLED",
      deactivatedAt: new Date(),
    },
  });

  emitEvent(EVENT_TYPES.USER_UPDATED, { userId: target.id, email: norm, action: "disabled" });
  return { ok: true, userId: target.id, email: norm };
}

/**
 * Read-only protection check used by the admin list to render row-level UI
 * affordances (e.g. greyed-out "Disable" button). Mirrors the refusal logic
 * inside `disableUserInWorkspace` but does not require an acting user since
 * the UI only needs the workspace-intrinsic protections.
 */
export async function isUserProtectedInWorkspace(params: {
  userId: string;
  tenantId: string;
}): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) return true;
  if (user.role === "SUPER_ADMIN") return true;
  const workspace = await prisma.workspace.findFirst({
    where: { OR: [{ id: params.tenantId }, { slug: params.tenantId }] },
  });
  if (!workspace) return true;
  if (workspace.ownerId === user.id) return true;
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  if (membership?.role === "WORKSPACE_ADMIN") {
    const otherAdmins = await prisma.workspaceMember.count({
      where: {
        workspaceId: workspace.id,
        role: "WORKSPACE_ADMIN",
        userId: { not: user.id },
      },
    });
    if (otherAdmins === 0) return true;
  }
  return false;
}

export async function getTenantRole(userId: string, workspaceId?: string | null): Promise<TenantRole | null> {
  const ws = workspaceId ?? (await getUserById(userId))?.tenantId;
  if (ws) {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws, userId } },
    });
    if (membership) return prismaRoleToTenantRole(membership.role);
  }
  const m = await resolvePrimaryWorkspaceMembership(userId);
  return m ? prismaRoleToTenantRole(m.role) : null;
}

export async function getAccessType(userId: string, workspaceId?: string | null): Promise<AccessType> {
  const role = await getTenantRole(userId, workspaceId);
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN" ? "OWNER" : "BRANCH_USER";
}

export async function isOwner(userId: string): Promise<boolean> {
  return (await getAccessType(userId)) === "OWNER";
}

export async function isBranchUser(userId: string): Promise<boolean> {
  return (await getAccessType(userId)) === "BRANCH_USER";
}

export async function getAssignedBranchIds(userId: string, workspaceId?: string | null): Promise<string[]> {
  const role = await getTenantRole(userId, workspaceId);
  if (role === "TENANT_OWNER" || role === "TENANT_ADMIN") return [ALL_BRANCHES_SENTINEL];
  const ws = workspaceId ?? (await getUserById(userId))?.tenantId;
  const assignments = await prisma.userBranchAssignment.findMany({
    where: ws ? { userId, workspaceId: ws } : { userId },
  });
  const ids = [...new Set(assignments.map((a) => a.branchId))];
  return ids.length > 0 ? ids : [DEFAULT_BRANCH_ID];
}

export async function getBranchesForUser(userId: string, workspaceId?: string | null): Promise<string[]> {
  return getAssignedBranchIds(userId, workspaceId);
}

export async function hasBranchAccess(
  userId: string,
  branchId: string,
  workspaceId?: string | null,
): Promise<boolean> {
  const allowed = await getBranchesForUser(userId, workspaceId);
  if (allowed.includes(ALL_BRANCHES_SENTINEL)) return true;
  const normalized = (branchId ?? "").trim() || DEFAULT_BRANCH_ID;
  return allowed.includes(normalized);
}

export async function getBranchRole(
  userId: string,
  branchId: string,
  workspaceId?: string | null,
): Promise<BranchRole | null> {
  const normalized = (branchId ?? "").trim() || DEFAULT_BRANCH_ID;
  const ws = workspaceId ?? (await getUserById(userId))?.tenantId;
  const assignment = await prisma.userBranchAssignment.findFirst({
    where: ws
      ? { userId, branchId: normalized, workspaceId: ws }
      : { userId, branchId: normalized },
  });
  return (assignment?.role as BranchRole) ?? null;
}
