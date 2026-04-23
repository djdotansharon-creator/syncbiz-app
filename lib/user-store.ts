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
  row: { id: string; email: string; name: string | null; passwordHash: string | null; createdAt: Date },
  workspaceId: string,
): User {
  return {
    id: row.id,
    email: row.email,
    tenantId: workspaceId,
    createdAt: row.createdAt.toISOString(),
    passwordHash: row.passwordHash ?? undefined,
    name: row.name ?? undefined,
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

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getUserByEmail(email: string): Promise<User | null> {
  const norm = email?.trim().toLowerCase();
  if (!norm) return null;
  const user = await prisma.user.findUnique({ where: { email: norm } });
  if (!user) return null;
  const membership = await prisma.workspaceMember.findFirst({ where: { userId: user.id } });
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
  const membership = await prisma.workspaceMember.findFirst({ where: { userId } });
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
  if (params.tenantRole === "TENANT_MEMBER" && rawAssignments.length === 0) {
    throw new Error("branchIds are required for BRANCH_USER");
  }
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

  return Promise.all(
    members.map(async (m) => {
      const tenantRole = prismaRoleToTenantRole(m.role);
      const accessType: AccessType = tenantRole === "TENANT_OWNER" || tenantRole === "TENANT_ADMIN" ? "OWNER" : "BRANCH_USER";
      if (accessType === "OWNER") {
        return { id: m.user.id, email: m.user.email, tenantId: workspace.id, createdAt: m.user.createdAt.toISOString(), name: m.user.name ?? undefined, accessType, branchIds: [] };
      }
      const assignments = await prisma.userBranchAssignment.findMany({ where: { userId: m.user.id, workspaceId: workspace.id } });
      const branchIds = [...new Set(assignments.map((a) => a.branchId))].filter(Boolean);
      return { id: m.user.id, email: m.user.email, tenantId: workspace.id, createdAt: m.user.createdAt.toISOString(), name: m.user.name ?? undefined, accessType, branchIds };
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
    },
  });
  await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    data: { role: prismaRole as import("@prisma/client").UserRole },
  });

  const rawAssignments = Array.isArray(params.branchAssignments) ? params.branchAssignments : [];
  if (params.tenantRole === "TENANT_MEMBER" && rawAssignments.length === 0) {
    throw new Error("branchIds are required for BRANCH_USER");
  }
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

export async function getTenantRole(userId: string): Promise<TenantRole | null> {
  const membership = await prisma.workspaceMember.findFirst({ where: { userId } });
  if (!membership) return null;
  return prismaRoleToTenantRole(membership.role);
}

export async function getAccessType(userId: string): Promise<AccessType> {
  const role = await getTenantRole(userId);
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN" ? "OWNER" : "BRANCH_USER";
}

export async function isOwner(userId: string): Promise<boolean> {
  return (await getAccessType(userId)) === "OWNER";
}

export async function isBranchUser(userId: string): Promise<boolean> {
  return (await getAccessType(userId)) === "BRANCH_USER";
}

export async function getAssignedBranchIds(userId: string): Promise<string[]> {
  const role = await getTenantRole(userId);
  if (role === "TENANT_OWNER" || role === "TENANT_ADMIN") return [ALL_BRANCHES_SENTINEL];
  const assignments = await prisma.userBranchAssignment.findMany({ where: { userId } });
  const ids = [...new Set(assignments.map((a) => a.branchId))];
  return ids.length > 0 ? ids : [DEFAULT_BRANCH_ID];
}

export async function getBranchesForUser(userId: string): Promise<string[]> {
  return getAssignedBranchIds(userId);
}

export async function hasBranchAccess(userId: string, branchId: string): Promise<boolean> {
  const allowed = await getBranchesForUser(userId);
  if (allowed.includes(ALL_BRANCHES_SENTINEL)) return true;
  const normalized = (branchId ?? "").trim() || DEFAULT_BRANCH_ID;
  return allowed.includes(normalized);
}

export async function getBranchRole(userId: string, branchId: string): Promise<BranchRole | null> {
  const normalized = (branchId ?? "").trim() || DEFAULT_BRANCH_ID;
  const assignment = await prisma.userBranchAssignment.findFirst({
    where: { userId, branchId: normalized },
  });
  return (assignment?.role as BranchRole) ?? null;
}
