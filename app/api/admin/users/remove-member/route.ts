/**
 * Removes a user from the current workspace only (`WorkspaceMember` +
 * `UserBranchAssignment`). Does not delete the global `User` row.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { removeUserFromWorkspace } from "@/lib/user-store";
import { prisma } from "@/lib/prisma";
import { extractClientIp, writeTenantAuditLog } from "@/lib/admin/tenant-audit";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!admin.tenantId?.trim()) {
    return NextResponse.json({ error: "Admin tenant context missing" }, { status: 400 });
  }

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  // Resolve target user + workspace before the destructive call so we can
  // write a meaningful audit row even though removeUserFromWorkspace deletes
  // the membership and assignment rows.
  const [targetUser, ws] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.workspace.findFirst({
      where: { OR: [{ id: admin.tenantId.trim() }, { slug: admin.tenantId.trim() }] },
      select: { id: true },
    }),
  ]);

  const outcome = await removeUserFromWorkspace({
    email,
    tenantId: admin.tenantId.trim(),
    actingUserId: admin.id,
  });

  if (!outcome.ok) {
    switch (outcome.reason) {
      case "not_found":
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      case "wrong_workspace":
        return NextResponse.json({ error: "User is not in your workspace" }, { status: 404 });
      case "workspace_owner":
        return NextResponse.json(
          { error: "Cannot remove the workspace owner", code: "CANNOT_REMOVE_OWNER" },
          { status: 403 },
        );
      case "super_admin":
        return NextResponse.json(
          { error: "Cannot remove a platform super admin", code: "CANNOT_REMOVE_SUPER_ADMIN" },
          { status: 403 },
        );
      case "last_admin":
        return NextResponse.json(
          { error: "Cannot remove the last workspace admin", code: "CANNOT_REMOVE_LAST_ADMIN" },
          { status: 400 },
        );
      default:
        return NextResponse.json({ error: "Cannot remove user" }, { status: 400 });
    }
  }

  if (ws && targetUser) {
    await writeTenantAuditLog(prisma, {
      action: "member.remove",
      actorUserId: admin.id,
      workspaceId: ws.id,
      targetUserId: targetUser.id,
      ipAddress: extractClientIp(req),
      metadata: { targetEmail: email },
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
