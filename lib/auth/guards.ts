/**
 * Server-only auth guards for protected surfaces.
 *
 * These are intentionally narrower and stricter than `lib/auth-helpers.ts`:
 * `auth-helpers` resolves the normal app session (workspace members,
 * controllers, etc.). `guards.ts` adds platform-level checks used by the
 * SyncBiz owner CRM — the `/admin` surface that sits *above* any single
 * workspace and touches canonical data.
 *
 * Key distinction: in the workspace domain, `SUPER_ADMIN` and
 * `WORKSPACE_ADMIN` both collapse to `TENANT_OWNER` (see
 * `prismaRoleToTenantRole` in `lib/user-store.ts`). For the platform
 * CRM we must NOT collapse them — only the real platform owner
 * (`UserRole.SUPER_ADMIN` on the raw `User` row) is allowed in.
 */

import "server-only";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import type { User as PrismaUser } from "@prisma/client";

export type SuperAdminUser = Pick<PrismaUser, "id" | "email" | "role" | "name">;

/**
 * Load the raw Prisma `User` row for the current session, or `null` if there
 * is no session. Unlike `getCurrentUserFromCookies` (which returns the app
 * `User` type without the platform `role`), this returns the platform-level
 * role so callers can gate on `SUPER_ADMIN` specifically.
 */
export async function getCurrentPlatformUser(): Promise<SuperAdminUser | null> {
  const session = await getCurrentUserFromCookies();
  if (!session) return null;
  const row = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true, name: true },
  });
  return row ?? null;
}

/** Non-throwing variant: returns the user if SUPER_ADMIN, else `null`. */
export async function getSuperAdminOrNull(): Promise<SuperAdminUser | null> {
  const user = await getCurrentPlatformUser();
  if (!user || user.role !== "SUPER_ADMIN") return null;
  return user;
}

/**
 * Server-component guard. If the caller is not a platform `SUPER_ADMIN`,
 * redirect them away from the page. Unauthenticated users go to `/login`;
 * authenticated-but-not-super go to `/` so we don't leak the existence of
 * the admin surface via a distinctive error.
 *
 * Call this at the top of every `/admin/**` server component/layout.
 */
export async function requireSuperAdmin(): Promise<SuperAdminUser> {
  const session = await getCurrentUserFromCookies();
  // `?from=` matches the existing login page convention (see app/login/page.tsx
  // which reads `searchParams.get("from")` and routes there on success).
  if (!session) redirect("/login?from=/admin");

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true, name: true },
  });
  if (!user || user.role !== "SUPER_ADMIN") redirect("/");
  return user;
}
