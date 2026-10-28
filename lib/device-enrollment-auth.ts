import "server-only";

/**
 * Who is asking, for the device-enrollment routes (docs/DEVICE_ENROLLMENT_DESIGN.md §4): the signed-in user of the ACTIVE workspace, and what they may decide.
 * Admin = WORKSPACE_ADMIN / SUPER_ADMIN membership (everything). Manager = MANAGER membership (only the branches assigned to them — the legacy "default" key never counts).
 * Everyone else may request a device but decide nothing. A locked desktop STATION never reaches this (same guard as user management).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getAuthorizedBranchIds } from "@/lib/user-store";
import { isAdminMembershipRole } from "@/lib/admin/user-management-policy";
import { isManagementLockedForRequest, managementLockedResponse } from "@/lib/management-access";
import type { User } from "@/lib/user-types";
import type { Actor } from "@/lib/device-enrollment";

export type EnrollmentCaller = { user: User; workspaceId: string; actor: Actor; isPlatformSuperAdmin: boolean };

export async function requireEnrollmentCaller(opts: { decide?: boolean } = {}): Promise<{ ok: true; caller: EnrollmentCaller } | { ok: false; response: NextResponse }> {
  const user = await getCurrentUserFromCookies();
  const ws = (user?.tenantId ?? "").trim();
  if (!user || !ws) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const [membership, row] = await Promise.all([
    prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws, userId: user.id } }, select: { role: true, status: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { role: true } }),
  ]);
  if (!membership || membership.status === "SUSPENDED") return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const isAdmin = isAdminMembershipRole(String(membership.role));
  const isManager = String(membership.role) === "MANAGER";
  if (opts.decide) {
    if (!isAdmin && !isManager) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    if (await isManagementLockedForRequest()) return { ok: false, response: managementLockedResponse() };
  }
  const branchIds = isAdmin ? [] : (await getAuthorizedBranchIds(user.id, ws)).filter((b) => b !== "default");
  return { ok: true, caller: { user, workspaceId: ws, actor: { userId: user.id, isAdmin, isManager, branchIds }, isPlatformSuperAdmin: String(row?.role ?? "") === "SUPER_ADMIN" } };
}

/** one client IP from the usual proxy headers (same order as lib/admin/tenant-audit.ts) */
export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() ?? "";
}
