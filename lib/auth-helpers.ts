/**
 * Stage 2 – Auth helpers for API routes.
 * Resolves session to User, provides branch/tenant access checks.
 * Uses existing cookie + parseSessionValue flow.
 */

import { cookies } from "next/headers";
import { parseSessionValue } from "@/lib/auth-session";
import { verifyWsTokenClaims, verifyDesktopAccessTokenClaims } from "@/lib/auth-ws-token";
import { enforceTokenWorkspaceScope } from "@/lib/desktop-token-scope";
import {
  getUserByEmail,
  getOrCreateUserByEmail,
  getUserById,
  hasBranchAccess as storeHasBranchAccess,
  getTenantRole,
  getBranchRole,
  getAccessType,
  getAssignedBranchIds,
  isOwner as storeIsOwner,
  isBranchUser as storeIsBranchUser,
  ALL_BRANCHES_SENTINEL_EXPORT,
} from "@/lib/user-store";
import type { User, SessionUser, BranchRole } from "@/lib/user-types";
import { ACTIVE_WORKSPACE_COOKIE_NAME } from "@/lib/active-workspace-constants";

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
  const email = cookie ? await parseSessionValue(cookie) : null;
  const activeWs = cookieStore.get(ACTIVE_WORKSPACE_COOKIE_NAME)?.value ?? null;
  if (!email?.trim()) {
    logIdentity("session_resolve", { result: "no_cookie" });
    return null;
  }
  const user = await getUserByEmail(email, { activeWorkspaceId: activeWs });
  if (user) {
    logIdentity("session_resolve", { result: "user", userId: user.id, email: user.email });
    return user;
  }
  logIdentity("session_resolve", { result: "no_user", email });
  return null;
}

/**
 * For API route handlers: session cookie first, then `Authorization: Bearer <ws-token>`
 * (same JWT as WS REGISTER from GET /api/auth/ws-token). Enables Electron desktop HTTP calls.
 */
export async function getCurrentUserFromApiRequest(request: Request): Promise<User | null> {
  const fromCookie = await getCurrentUserFromCookies();
  if (fromCookie) return fromCookie;
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const claims = verifyWsTokenClaims(token);
  if (!claims) return null;
  // Gate 3B-1: bearer auth is scoped to the token's SIGNED workspace — never the user's primary workspace.
  // No workspace claim → deny (fail closed); non-member / silent fallback → deny (enforceTokenWorkspaceScope).
  if (!claims.workspaceId) {
    logIdentity("session_resolve", { result: "denied", reason: "bearer_missing_workspace", via: "bearer_ws_token" });
    return null;
  }
  const resolved = await getUserById(claims.userId, { activeWorkspaceId: claims.workspaceId });
  const user = enforceTokenWorkspaceScope(claims, resolved);
  if (user) {
    logIdentity("session_resolve", { result: "user", userId: user.id, workspaceId: claims.workspaceId, via: "bearer_ws_token" });
  }
  return user;
}

/**
 * Desktop-MAIN-ONLY resolver: requires `Authorization: Bearer <desktop_access>`. Does NOT fall back to the
 * session cookie and does NOT accept a `ws_register` token. For endpoints (e.g. POST /api/devices/register)
 * that only the Electron desktop MAIN may call. Returns null (→ 401) for a missing/non-bearer header, an empty
 * token, a ws_register token, or an invalid/expired desktop_access token.
 */
export async function getDesktopUserFromApiRequest(request: Request): Promise<User | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null; // no cookie fallback by design
  const token = auth.slice(7).trim();
  if (!token) return null;
  const claims = verifyDesktopAccessTokenClaims(token); // desktop_access ONLY; rejects ws_register
  if (!claims || !claims.workspaceId) return null; // must carry the signed workspace scope
  // Resolve the user SPECIFICALLY in the token's workspace (membership validated by resolveActiveTenantScope),
  // then hard-gate: reject any silent fallback to the user's primary/other workspace (no token-scope drift).
  const resolved = await getUserById(claims.userId, { activeWorkspaceId: claims.workspaceId });
  const user = enforceTokenWorkspaceScope(claims, resolved);
  if (user) {
    logIdentity("session_resolve", {
      result: "user",
      userId: user.id,
      workspaceId: claims.workspaceId,
      via: "bearer_desktop_access",
    });
  }
  return user;
}

/**
 * Resolve session to full SessionUser (with roles and branch access).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const user = await getCurrentUserFromCookies();
  if (!user) return null;
  const tenantRole = await getTenantRole(user.id, user.tenantId);
  const branchIds = await getAssignedBranchIds(user.id, user.tenantId);
  const branchRoles: Record<string, BranchRole> = {};
  for (const bid of branchIds) {
    if (bid === ALL_BRANCHES_SENTINEL_EXPORT) continue;
    const r = await getBranchRole(user.id, bid, user.tenantId);
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

// Gate 3B-1: every authorization helper takes the ACTIVE workspace explicitly (session flows pass user.tenantId).
// None of them resolves the user's primary workspace; a missing workspace fails closed.
const activeWs = (workspaceId: string | null | undefined) => (workspaceId ?? "").trim();

/** Check if user has access to branch in the ACTIVE workspace. */
export async function hasBranchAccess(userId: string, branchId: string, workspaceId: string | null | undefined): Promise<boolean> {
  const ws = activeWs(workspaceId);
  if (!ws) return false;
  return storeHasBranchAccess(userId, branchId ?? DEFAULT_BRANCH_ID, ws);
}

/** Check if user has tenant-level admin role in the ACTIVE workspace. */
export async function hasTenantAdminRole(userId: string, workspaceId: string | null | undefined): Promise<boolean> {
  const ws = activeWs(workspaceId);
  if (!ws) return false;
  const r = await getTenantRole(userId, ws);
  return r === "TENANT_OWNER" || r === "TENANT_ADMIN";
}

/** V1 public: simplified access type in the ACTIVE workspace (no workspace → BRANCH_USER, the least privilege). */
export async function getAccessTypeForUser(userId: string, workspaceId: string | null | undefined): Promise<"OWNER" | "BRANCH_USER"> {
  const ws = activeWs(workspaceId);
  if (!ws) return "BRANCH_USER";
  return getAccessType(userId, ws);
}

/** V1 public: assigned branch IDs in the ACTIVE workspace. OWNER returns ["*"]; no workspace → []. */
export async function getAssignedBranchIdsForUser(userId: string, workspaceId: string | null | undefined): Promise<string[]> {
  const ws = activeWs(workspaceId);
  if (!ws) return [];
  return getAssignedBranchIds(userId, ws);
}

/** V1 public: is OWNER in the ACTIVE workspace. */
export async function isOwner(userId: string, workspaceId: string | null | undefined): Promise<boolean> {
  return storeIsOwner(userId, workspaceId);
}

/** V1 public: is BRANCH_USER in the ACTIVE workspace. */
export async function isBranchUser(userId: string, workspaceId: string | null | undefined): Promise<boolean> {
  return storeIsBranchUser(userId, workspaceId);
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
  const isAdmin = await hasTenantAdminRole(user.id, user.tenantId);
  return isAdmin ? user : null;
}

/**
 * Check branch access. For future enforcement - returns false if no access.
 * Does not throw; caller decides how to respond.
 */
export async function requireBranchAccess(userId: string, branchId: string, workspaceId: string | null | undefined): Promise<boolean> {
  return hasBranchAccess(userId, branchId ?? DEFAULT_BRANCH_ID, workspaceId);
}
