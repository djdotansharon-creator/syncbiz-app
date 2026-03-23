/**
 * Stage 2 – Persistent user store.
 * File-based: data/users.json. Load on first use, save after mutations.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
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
};

const tenants = new Map<string, Tenant>();
const users = new Map<string, User>();
const usersByEmail = new Map<string, string>();
const membershipsByUser = new Map<string, Membership[]>();
const branchAssignmentsByUser = new Map<string, UserBranchAssignment[]>();

let loaded = false;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function ensureDataDir(): Promise<void> {
  const path = getUsersDataPath();
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
}

async function loadFromFile(): Promise<void> {
  if (loaded) return;
  loaded = true;
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
  } catch (e) {
    console.warn("[user-store] Load failed, seeding fresh:", e);
    tenants.clear();
    users.clear();
    usersByEmail.clear();
    membershipsByUser.clear();
    branchAssignmentsByUser.clear();
    await seedLegacyAndSave();
  }
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
  const user: User = {
    id,
    email: norm,
    tenantId: DEFAULT_TENANT_ID,
    createdAt: now,
    passwordHash: hashPassword(params.password),
  };
  users.set(id, user);
  usersByEmail.set(norm, id);
  membershipsByUser.set(id, [
    { userId: id, tenantId: DEFAULT_TENANT_ID, role: params.tenantRole },
  ]);
  const assignments = (params.branchAssignments ?? []).length > 0
    ? params.branchAssignments.map((a) => ({
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
