/**
 * Platform workspace drill-down — remove `WorkspaceMember` + `UserBranchAssignment` only.
 * Requires typed email confirmation. Only `SUPER_ADMIN` platform users (see route).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { removeUserFromWorkspace } from "@/lib/user-store";
import { prisma } from "@/lib/prisma";
import { extractClientIp, writeTenantAuditLog } from "@/lib/admin/tenant-audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireSuperAdmin();
  const { id: workspaceId } = await params;
  if (!workspaceId?.trim()) {
    return NextResponse.json({ error: "Workspace id required" }, { status: 400 });
  }

  let body: { email?: string; confirmationEmail?: string };
  try {
    body = (await req.json()) as { email?: string; confirmationEmail?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const confirm = typeof body.confirmationEmail === "string" ? body.confirmationEmail.trim().toLowerCase() : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (confirm !== email) {
    return NextResponse.json(
      { error: "Confirmation email must exactly match the member email", code: "CONFIRMATION_MISMATCH" },
      { status: 400 },
    );
  }

  // Resolve target user + canonical workspace id before the destructive call
  // so the audit row keeps the linkage even after the membership is gone, and
  // so we never insert a slug into `AuditLog.workspaceId` (FK requires the
  // real workspace UUID).
  const [targetUser, ws] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.workspace.findFirst({
      where: { OR: [{ id: workspaceId }, { slug: workspaceId }] },
      select: { id: true },
    }),
  ]);

  const outcome = await removeUserFromWorkspace({
    email,
    tenantId: workspaceId,
    actingUserId: admin.id,
    policy: "platform_super_admin_drilldown",
  });

  if (!outcome.ok) {
    switch (outcome.reason) {
      case "not_found":
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      case "wrong_workspace":
        return NextResponse.json({ error: "User is not a member of this workspace" }, { status: 404 });
      case "workspace_owner":
        return NextResponse.json(
          { error: "Cannot remove the workspace owner from this workspace", code: "CANNOT_REMOVE_OWNER" },
          { status: 403 },
        );
      case "super_admin":
        /* Should not happen on platform policy — kept for safety */
        return NextResponse.json({ error: "Cannot remove member" }, { status: 403 });
      case "last_admin":
        return NextResponse.json(
          {
            error:
              "Cannot remove the sole workspace tenant admin unless you are removing your own membership (use your row).",
            code: "CANNOT_REMOVE_LAST_ADMIN",
          },
          { status: 400 },
        );
      default:
        return NextResponse.json({ error: "Cannot remove member" }, { status: 400 });
    }
  }

  if (targetUser && ws) {
    // Surface the removal in the workspace's own audit feed so the tenant
    // owner can see "platform admin removed X on date Y" without having
    // platform access. Distinct action so UI can label it differently.
    await writeTenantAuditLog(prisma, {
      action: "member.platform_remove",
      actorUserId: admin.id,
      workspaceId: ws.id,
      targetUserId: targetUser.id,
      ipAddress: extractClientIp(req),
      metadata: { targetEmail: email, confirmation: "email_match" },
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
