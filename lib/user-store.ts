/**
 * Stage 2 – Persistent user store.
 * File-based: data/users.json. Load on first use, save after mutations.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { createHash, randomBytes } from "crypto";
import { getUsersDataPath } from "./data-path";
import { hashPassword } from "./password-utils";
import { emitEvent, EVENT_TYPES } from "./analytics-boundary";
import type { User, Tenant, Membership, UserBranchAssignment, TenantRole, BranchRole, AccessType } from "./user-types";

const DEFAULT_TENANT_ID = "tnt-default";
const DEFAULT_BRANCH_ID = "default";

/** Sentinel meaning user can access all branches (OWNER). */
const ALL_BRANCHES_SENTINEL = "*";

/** Emails that can authenticate via TEST_USERS. Must stay in sync with lib/auth.ts. */
const LEGACY_SEED_EMAILS = ["test@syncbiz.com", "djdotansharon@gmail.com"];

type PersistedData = {
  tenants: Tenant[];
  users: User[];
  memberships: Membership[];
  branchAssignments: UserBranchAssignment[];
  resetTokens?: PasswordResetToken[];
};

type PasswordResetToken = {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

const tenants = new Map<string, Tenant>();
const users = new Map<string, User>();
const usersByEmail = new Map<string, string>();
const membershipsByUser = new Map<string, Membership[]>();
const branchAssignmentsByUser = new Map<string, UserBranchAssignment[]>();
let resetTokens: PasswordResetToken[] = [];

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function ensureDataDir(): Promise<void> {
  const path = getUsersDataPath();
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
}

async function loadFromFile(): Promise<void> {
  tenants.clear();
  users.clear();
  usersByEmail.clear();
  membershipsByUser.clear();
  branchAssignmentsByUser.clear();
  resetTokens = [];
  const path = getUsersDataPath();
  try {
    if (!existsSync(path)) {
      await seedLegacyAndSave();
      return;
    }
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as PersistedData;
    (data.tenants ?? []).forEach((t) => tenants.set(t.id, t));
    (data.users ?? []).forEach((u) => {
      users.set(u.id, u);
      usersByEmail.set(u.email.trim().toLowerCase(), u.id);
    });
    (data.memberships ?? []).forEach((m) => {
      const list = membershipsByUser.get(m.userId) ?? [];
      list.push(m);
      membershipsByUser.set(m.userId, list);
    });
    (data.branchAssignments ?? []).forEach((a) => {
      const list = branchAssignmentsByUser.get(a.userId) ?? [];
      list.push(a);
      branchAssignmentsByUser.set(a.userId, list);
    });
    resetTokens = Array.isArray(data.resetTokens) ? data.resetTokens : [];
    if (tenants.size === 0) {
      tenants.set(DEFAULT_TENANT_ID, {
        id: DEFAULT_TENANT_ID,
        name: "SyncBiz Demo",
        createdAt: new Date().toISOString(),
      });
    }
    const needsLegacy = LEGACY_SEED_EMAILS.some((e) => !usersByEmail.has(e.trim().toLowerCase()));
    if (needsLegacy) {
      await seedLegacyAndSave();
    }
    const needsIdentityPatch = patchLegacyIdentityDefaults();
    if (needsIdentityPatch) {
      await saveToFile();
    }
  } catch (e) {
    console.warn("[user-store] Load failed, seeding fresh:", e);
    await seedLegacyAndSave();
  }
}

function patchLegacyIdentityDefaults(): boolean {
  let changed = false;
  const tenant = tenants.get(DEFAULT_TENANT_ID);
  if (tenant && tenant.name === "SyncBiz Demo") {
    tenants.set(DEFAULT_TENANT_ID, { ...tenant, name: "Octopus DJ" });
    changed = true;
  }
  const demoNameByEmail: Record<string, string> = {
    "djdotansharon@gmail.com": "Dotan Sharon",
    "test@syncbiz.com": "Test User",
  };
  for (const user of users.values()) {
    if (user.tenantId !== DEFAULT_TENANT_ID) continue;
    if (user.name?.trim()) continue;
    const mapped = demoNameByEmail[user.email.trim().toLowerCase()];
    if (!mapped) continue;
    users.set(user.id, { ...user, name: mapped });
    changed = true;
  }
  return changed;
}

async function seedLegacyAndSave(): Promise<void> {
  const now = new Date().toISOString();
  if (!tenants.has(DEFAULT_TENANT_ID)) {
    tenants.set(DEFAULT_TENANT_ID, {
      id: DEFAULT_TENANT_ID,
      name: "SyncBiz Demo",
      createdAt: now,
    });
  }
  for (const email of LEGACY_SEED_EMAILS) {
    const norm = email.trim().toLowerCase();
    if (usersByEmail.has(norm)) continue;
    const id = generateId("usr");
    const user: User = {
      id,
      email: norm,
      tenantId: DEFAULT_TENANT_ID,
      createdAt: now,
    };
    users.set(id, user);
    usersByEmail.set(norm, id);
    membershipsByUser.set(id, [
      { userId: id, tenantId: DEFAULT_TENANT_ID, role: "TENANT_OWNER" },
    ]);
    branchAssignmentsByUser.set(id, [
      { userId: id, branchId: DEFAULT_BRANCH_ID, role: "BRANCH_MANAGER" },
    ]);
  }
  await saveToFile();
}

async function saveToFile(): Promise<void> {
  await ensureDataDir();
  const path = getUsersDataPath();
  const data: PersistedData = {
    tenants: [...tenants.values()],
    users: [...users.values()].map((u) => ({ ...u })),
    memberships: [...membershipsByUser.values()].flat(),
    branchAssignments: [...branchAssignmentsByUser.values()].flat(),
    resetTokens: [...resetTokens],
  };
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

/** Get user by email. Returns null if not found. */
export async function getUserByEmail(email: string): Promise<User | null> {
  await loadFromFile();
  const norm = email?.trim().toLowerCase();
  if (!norm) return null;
  const id = usersByEmail.get(norm);
  return id ? users.get(id) ?? null : null;
}

/**
 * Get or create user by email. Used after successful login.
 * Creates User only for LEGACY_SEED_EMAILS when missing (migration).
 */
export async function getOrCreateUserByEmail(email: string): Promise<User> {
  await loadFromFile();
  const norm = email?.trim().toLowerCase();
  if (!norm) throw new Error("Email required");
  const existing = await getUserByEmail(norm);
  if (existing) return existing;
  if (!LEGACY_SEED_EMAILS.includes(norm)) {
    throw new Error("User not found");
  }
  const now = new Date().toISOString();
  const id = generateId("usr");
  const user: User = {
    id,
    email: norm,
    tenantId: DEFAULT_TENANT_ID,
    createdAt: now,
  };
  users.set(id, user);
  usersByEmail.set(norm, id);
  membershipsByUser.set(id, [
    { userId: id, tenantId: DEFAULT_TENANT_ID, role: "TENANT_OWNER" },
  ]);
  branchAssignmentsByUser.set(id, [
    { userId: id, branchId: DEFAULT_BRANCH_ID, role: "BRANCH_MANAGER" },
  ]);
  await saveToFile();
  return user;
}

/** Get user by id. */
export async function getUserById(userId: string): Promise<User | null> {
  await loadFromFile();
  return users.get(userId) ?? null;
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  await loadFromFile();
  return tenants.get(tenantId) ?? null;
}

/** List all users. */
export async function listUsers(): Promise<User[]> {
  await loadFromFile();
  return [...users.values()].map((u) => ({ ...u, passwordHash: undefined }));
}

/**
 * Create a new user with password, tenant role, and branch assignments.
 * Requires admin (caller must check).
 */
export async function createUser(params: {
  email: string;
  password: string;
  tenantRole: TenantRole;
  branchAssignments: Array<{ branchId: string; role: BranchRole }>;
  tenantId: string;
  name?: string;
}): Promise<User> {
  await loadFromFile();
  const norm = params.email?.trim().toLowerCase();
  if (!norm) throw new Error("Email required");
  if (!params.password || params.password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  if (usersByEmail.has(norm)) {
    throw new Error("User already exists");
  }
  const now = new Date().toISOString();
  const id = generateId("usr");
  const tenantId = (params.tenantId ?? "").trim();
  if (!tenantId) {
    throw new Error("tenantId is required for user creation");
  }
  if (!tenants.has(tenantId)) {
    throw new Error("tenantId does not exist");
  }
  const user: User = {
    id,
    email: norm,
    tenantId,
    createdAt: now,
    passwordHash: hashPassword(params.password),
    name: params.name?.trim() || undefined,
  };
  users.set(id, user);
  usersByEmail.set(norm, id);
  membershipsByUser.set(id, [
    { userId: id, tenantId, role: params.tenantRole },
  ]);

  const rawAssignments = Array.isArray(params.branchAssignments) ? params.branchAssignments : [];
  const tenantRequiresExplicitBranches = params.tenantRole === "TENANT_MEMBER";
  if (tenantRequiresExplicitBranches) {
    if (rawAssignments.length === 0) {
      throw new Error("branchIds are required for BRANCH_USER");
    }
    if (rawAssignments.some((a) => !(typeof a?.branchId === "string" && a.branchId.trim().length > 0))) {
      throw new Error("branchIds must be valid strings for BRANCH_USER");
    }
  }

  const assignments =
    rawAssignments.length > 0
      ? rawAssignments.map((a) => ({
          userId: id,
          branchId: (a.branchId ?? DEFAULT_BRANCH_ID).trim() || DEFAULT_BRANCH_ID,
          role: a.role,
        }))
      : [{ userId: id, branchId: DEFAULT_BRANCH_ID, role: "BRANCH_CONTROLLER" as BranchRole }];

  branchAssignmentsByUser.set(id, assignments);
  await saveToFile();
  emitEvent(EVENT_TYPES.USER_CREATED, { userId: id, email: norm });
  return { ...user, passwordHash: undefined };
}

/**
 * List users for admin UI with resolved access scope.
 * Loads operational maps once and computes scope without extra file reads.
 */
export async function listUsersWithScopeForTenant(tenantId: string): Promise<
  Array<{
    id: string;
    email: string;
    tenantId: string;
    createdAt: string;
    name?: string;
    accessType: AccessType;
    branchIds: string[];
  }>
> {
  await loadFromFile();
  const tid = (tenantId ?? "").trim();
  const all = [...users.values()].filter((u) => u.tenantId === tid);
  return all.map((u) => {
    const memberships = membershipsByUser.get(u.id) ?? [];
    const membership = memberships.find((m) => m.tenantId === tid) ?? memberships[0];
    const role = membership?.role ?? null;
    const accessType: AccessType = role === "TENANT_OWNER" || role === "TENANT_ADMIN" ? "OWNER" : "BRANCH_USER";
    if (accessType === "OWNER") {
      // For OWNER we treat access as "all branches" conceptually; return [] to avoid accidental assumptions.
      return {
        id: u.id,
        email: u.email,
        tenantId: u.tenantId,
        createdAt: u.createdAt,
        name: u.name,
        accessType,
        branchIds: [],
      };
    }
    const assignments = branchAssignmentsByUser.get(u.id) ?? [];
    const ids = [...new Set(assignments.map((a) => a.branchId))].map((x) => (x ?? "").trim()).filter(Boolean);
    // No fallback: if branches are missing, return empty to keep admin mistakes visible.
    return {
      id: u.id,
      email: u.email,
      tenantId: u.tenantId,
      createdAt: u.createdAt,
      name: u.name,
      accessType,
      branchIds: ids,
    };
  });
}

/**
 * Update existing user identity + access scope.
 * Does not touch password (password changes remain out of scope for now).
 */
export async function updateUser(params: {
  email: string;
  tenantId: string;
  tenantRole: TenantRole;
  name?: string;
  branchAssignments: Array<{ branchId: string; role: BranchRole }>;
}): Promise<User> {
  await loadFromFile();
  const norm = params.email?.trim().toLowerCase();
  if (!norm) throw new Error("Email required");
  const id = usersByEmail.get(norm);
  if (!id) throw new Error("User not found");
  const existing = users.get(id);
  if (!existing) throw new Error("User not found");

  const tid = (params.tenantId ?? "").trim();
  if (existing.tenantId !== tid) {
    throw new Error("Forbidden: user not in this tenant");
  }

  const nextName =
    typeof params.name === "string" ? params.name.trim() : undefined;

  users.set(id, {
    ...existing,
    name: nextName && nextName.length > 0 ? nextName : nextName === "" ? undefined : existing.name,
  });

  // Replace tenant membership role for the target tenant.
  const memberships = membershipsByUser.get(id) ?? [];
  const nextMemberships = memberships
    .filter((m) => m.tenantId !== tid)
    .concat([{ userId: id, tenantId: tid, role: params.tenantRole } as Membership]);
  membershipsByUser.set(id, nextMemberships);

  // Replace branch assignments for the target user.
  const rawAssignments = Array.isArray(params.branchAssignments) ? params.branchAssignments : [];
  const tenantRequiresExplicitBranches = params.tenantRole === "TENANT_MEMBER";
  if (tenantRequiresExplicitBranches) {
    if (rawAssignments.length === 0) {
      throw new Error("branchIds are required for BRANCH_USER");
    }
    if (rawAssignments.some((a) => !(typeof a?.branchId === "string" && a.branchId.trim().length > 0))) {
      throw new Error("branchIds must be valid strings for BRANCH_USER");
    }
  }

  const assignments =
    rawAssignments.length > 0
      ? rawAssignments.map((a) => ({
          userId: id,
          branchId: (a.branchId ?? DEFAULT_BRANCH_ID).trim() || DEFAULT_BRANCH_ID,
          role: a.role,
        }))
      : [{ userId: id, branchId: DEFAULT_BRANCH_ID, role: "BRANCH_CONTROLLER" as BranchRole }];
  branchAssignmentsByUser.set(id, assignments);

  await saveToFile();
  emitEvent(EVENT_TYPES.USER_UPDATED, { userId: id, email: norm });
  emitEvent(EVENT_TYPES.BRANCH_ASSIGNMENT_CHANGED, { userId: id, email: norm });

  const updated = users.get(id)!;
  return { ...updated, passwordHash: undefined };
}

export async function createWorkspaceOwner(params: {
  email: string;
  password: string;
  workspaceName: string;
  ownerName?: string;
}): Promise<{ user: User; tenant: Tenant }> {
  await loadFromFile();
  const norm = params.email?.trim().toLowerCase();
  if (!norm) throw new Error("Email required");
  if (!params.password || params.password.length < 6) throw new Error("Password must be at least 6 characters");
  if (usersByEmail.has(norm)) throw new Error("User already exists");

  const now = new Date().toISOString();
  const tenantId = generateId("tnt");
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
    throw new Error("Failed to allocate isolated tenant");
  }
  const tenant: Tenant = {
    id: tenantId,
    name: params.workspaceName?.trim() || "SyncBiz Workspace",
    createdAt: now,
  };
  tenants.set(tenantId, tenant);
  // Persist tenant first so createUser() reload/validation sees it.
  await saveToFile();

  const created = await createUser({
    email: norm,
    password: params.password,
    tenantRole: "TENANT_OWNER",
    branchAssignments: [{ branchId: DEFAULT_BRANCH_ID, role: "BRANCH_MANAGER" }],
    tenantId,
    name: params.ownerName,
  });
  return { user: created, tenant };
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPasswordResetToken(email: string): Promise<string | null> {
  await loadFromFile();
  const user = await getUserByEmail(email);
  if (!user) return null;
  const rawToken = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 30); // 30 minutes
  resetTokens = resetTokens.filter((t) => !(t.userId === user.id && !t.usedAt));
  resetTokens.push({
    tokenHash: hashResetToken(rawToken),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  });
  await saveToFile();
  return rawToken;
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<"ok" | "invalid_token" | "expired" | "weak_password"> {
  await loadFromFile();
  if (!newPassword || newPassword.length < 6) return "weak_password";
  const tokenHash = hashResetToken(token);
  const idx = resetTokens.findIndex((t) => t.tokenHash === tokenHash && !t.usedAt);
  if (idx < 0) return "invalid_token";
  const rec = resetTokens[idx];
  if (new Date(rec.expiresAt).getTime() < Date.now()) return "expired";
  const user = users.get(rec.userId);
  if (!user) return "invalid_token";
  users.set(user.id, {
    ...user,
    passwordHash: hashPassword(newPassword),
  });
  resetTokens[idx] = { ...rec, usedAt: new Date().toISOString() };
  await saveToFile();
  return "ok";
}

/** Get tenant-level role for user. */
export async function getTenantRole(userId: string): Promise<"TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_MEMBER" | null> {
  await loadFromFile();
  const list = membershipsByUser.get(userId) ?? [];
  return list[0]?.role ?? null;
}

/** V1 public: map internal role to AccessType. */
export async function getAccessType(userId: string): Promise<AccessType> {
  const role = await getTenantRole(userId);
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN" ? "OWNER" : "BRANCH_USER";
}

/** V1 public: OWNER = true. */
export async function isOwner(userId: string): Promise<boolean> {
  return (await getAccessType(userId)) === "OWNER";
}

/** V1 public: BRANCH_USER = true. */
export async function isBranchUser(userId: string): Promise<boolean> {
  return (await getAccessType(userId)) === "BRANCH_USER";
}

/** V1 public: assigned branch IDs. OWNER returns [ALL_BRANCHES_SENTINEL]. */
export async function getAssignedBranchIds(userId: string): Promise<string[]> {
  const role = await getTenantRole(userId);
  if (role === "TENANT_OWNER" || role === "TENANT_ADMIN") {
    return [ALL_BRANCHES_SENTINEL];
  }
  const assignments = branchAssignmentsByUser.get(userId) ?? [];
  const ids = [...new Set(assignments.map((a) => a.branchId))];
  return ids.length > 0 ? ids : [DEFAULT_BRANCH_ID];
}

/** Get branch IDs the user can access (internal + public). OWNER = [*]. */
export async function getBranchesForUser(userId: string): Promise<string[]> {
  return getAssignedBranchIds(userId);
}

/** Check if user has access to branch. OWNER has access to all. */
export async function hasBranchAccess(userId: string, branchId: string): Promise<boolean> {
  const allowed = await getBranchesForUser(userId);
  if (allowed.includes(ALL_BRANCHES_SENTINEL)) return true;
  const normalized = (branchId ?? "").trim() || DEFAULT_BRANCH_ID;
  return allowed.includes(normalized);
}

/** Expose sentinel for callers that need to detect "all branches". */
export const ALL_BRANCHES_SENTINEL_EXPORT = ALL_BRANCHES_SENTINEL;

/** Get branch-level role for user. */
export async function getBranchRole(userId: string, branchId: string): Promise<BranchRole | null> {
  await loadFromFile();
  const assignments = branchAssignmentsByUser.get(userId) ?? [];
  const normalized = (branchId ?? "").trim() || DEFAULT_BRANCH_ID;
  const a = assignments.find((x) => x.branchId === normalized);
  return a?.role ?? null;
}
