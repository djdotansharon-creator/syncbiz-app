import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getAccessType, getAssignedBranchIds, getTenantById, listEligibleWorkspacesForUser } from "@/lib/user-store";
import { ensureUserHandleOnce } from "@/lib/user-handle-store";

/** Returns current user from session. V1 public shape: accessType, accountId, branchIds. */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ email: null, userId: null }, { status: 200 });
  }
  ensureUserHandleOnce(user.id); // owner 2026-11-23: every person gets their VONO ID (once), so they can be found by it
  const [accessType, branchIds, workspaces] = await Promise.all([
    getAccessType(user.id, user.tenantId),
    getAssignedBranchIds(user.id, user.tenantId),
    listEligibleWorkspacesForUser(user.id),
  ]);
  const tenant = await getTenantById(user.tenantId);
  const platformRow = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });
  return NextResponse.json({
    email: user.email,
    userId: user.id,
    name: user.name ?? null,
    accountId: user.tenantId,
    accountName: tenant?.name ?? null,
    tenantId: user.tenantId,
    workspaces,
    accessType,
    branchIds,
    isPlatformSuperAdmin: platformRow?.role === "SUPER_ADMIN",
  });
}
