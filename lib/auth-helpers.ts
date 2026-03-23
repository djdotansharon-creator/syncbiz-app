/**
 * Stage 2 – Auth helpers for API routes.
 * Resolves session to User, provides branch/tenant access checks.
 * Uses existing cookie + parseSessionValue flow.
 */

import { cookies } from "next/headers";
import { parseSessionValue } from "@/lib/auth-session";
import {
  getUserByEmail,
  getOrCreateUserByEmail,
  getUserById,
  hasBranchAccess as storeHasBranchAccess,
  getBranchesForUser,
  getTenantRole,
  getBranchRole,
  getAccessType,
  getAssignedBranchIds,
  isOwner as storeIsOwner,
  isBranchUser as storeIsBranchUser,
} from "@/lib/user-store";
import type { User, SessionUser, BranchRole } from "@/lib/user-types";

const COOKIE_NAME = "syncbiz-session";
const DEFAULT_BRANCH_ID = "default";

const LOG_PREFIX = "[SyncBiz auth]";

function logIdentity(event: string, data: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info(LOG_PREFIX, event, data);
  }
}

/**
 * Resolve session cookie to User. Returns null if not authenticated.
 * Does NOT create users – use only when you already have a valid session.
 */
export async function getCurrentUserFromCookies(): Promise<User | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;
  const email = cookie ? parseSessionValue(cookie) : null;
  if (!email?.trim()) {
    logIdentity("session_resolve", { result: "no_cookie" });
    return null;
  }
  const user = await getUserByEmail(email);
  if (user) {
    logIdentity("session_resolve", { result: "user", userId: user.id, email: user.email });
    return user;
  }
  logIdentity("session_resolve", { result: "no_user", email });
  return null;
}

/**
 * Resolve session to full SessionUser (with roles and branch access).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await getCurrentUserFromCookies();
  if (!user) return null;
  const tenantRole = await getTenantRole(user.id);
  const branchIds = await getBranchesForUser(user.id);
  const branchRoles: Record<string, BranchRole> = {};
  for (const bid of branchIds) {
    const r = await getBranchRole(user.id, bid);
    if (r) branchRoles[bid] = r;
  }
  return {
    id: user.id,
    email: user.email,
    tenantId: user.tenantId,
    tenantRole,
    branchIds,
    branchRoles,
  };
}

/**
 * Resolve email (e.g. from cookie) to User. Creates User if not exists (for login flow).
 */
export async function resolveEmailToUser(email: string): Promise<User> {
  return getOrCreateUserByEmail(email);
}

/** Check if user has access to branch. */
export async function hasBranchAccess(userId: string, branchId: string): Promise<boolean> {
  return storeHasBranchAccess(userId, branchId ?? DEFAULT_BRANCH_ID);
}

/** Check if user has tenant-level admin role. */
export async function hasTenantAdminRole(userId: string): Promise<boolean> {
  const r = await getTenantRole(userId);
  return r === "TENANT_OWNER" || r === "TENANT_ADMIN";
}

/** V1 public: get simplified access type. */
export async function getAccessTypeForUser(userId: string): Promise<"OWNER" | "BRANCH_USER"> {
  return getAccessType(userId);
}

/** V1 public: assigned branch IDs. OWNER returns ["*"]. */
export async function getAssignedBranchIdsForUser(userId: string): Promise<string[]> {
  return getAssignedBranchIds(userId);
}

/** V1 public: is OWNER. */
export async function isOwner(userId: string): Promise<boolean> {
  return storeIsOwner(userId);
}

/** V1 public: is BRANCH_USER. */
export async function isBranchUser(userId: string): Promise<boolean> {
  return storeIsBranchUser(userId);
}

/**
 * Get stable userId from session for broadcast/WS targeting.
 * Returns null if not authenticated. Use this for notifyLibraryUpdated etc.
 */
export async function getUserIdFromSession(): Promise<string | null> {
  const user = await getCurrentUserFromCookies();
  return user?.id ?? null;
}

/**
 * Require current user to be admin (TENANT_OWNER or TENANT_ADMIN).
 * Returns user or null. Use before admin-only operations.
 */
export async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUserFromCookies();
  if (!user) return null;
  const isAdmin = await hasTenantAdminRole(user.id);
  return isAdmin ? user : null;
}

/**
 * Check branch access. For future enforcement - returns false if no access.
 * Does not throw; caller decides how to respond.
 */
export async function requireBranchAccess(userId: string, branchId: string): Promise<boolean> {
  return hasBranchAccess(userId, branchId ?? DEFAULT_BRANCH_ID);
}
