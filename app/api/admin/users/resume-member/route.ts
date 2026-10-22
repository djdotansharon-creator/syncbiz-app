/**
 * Re-activates a previously paused workspace membership
 * (`WorkspaceMember.status = ACTIVE`). Idempotent — already-active memberships
 * succeed without side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { shadowAuthorize } from "@/lib/authz";
import { requireWorkspaceAdmin, loadWorkspaceMemberTarget } from "@/lib/auth-helpers";
import { checkMembershipOp } from "@/lib/admin/user-management-policy";
import { resumeMembershipInWorkspace } from "@/lib/user-store";
import { prisma } from "@/lib/prisma";
import { extractClientIp, writeTenantAuditLog } from "@/lib/admin/tenant-audit";

export async function POST(req: NextRequest) {
  const guard = await requireWorkspaceAdmin(); // Gate 3B-3: WORKSPACE_ADMIN of the ACTIVE workspace only (MANAGER → 403)
  const admin = guard?.user ?? null;
  if (admin) shadowAuthorize("admin/users/resume-member:POST", { userId: admin.id, workspaceId: admin.tenantId }, "users.manage", []); // Gate 3A shadow: log only, never blocks
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

  // Gate 3B-3: owner row never; another WORKSPACE_ADMIN only by the Workspace Owner (or platform SUPER_ADMIN).
  const opTarget = await loadWorkspaceMemberTarget(guard!.workspaceId, email);
  const opDenied = opTarget ? checkMembershipOp(guard!, opTarget, "resume") : null;
  if (opDenied) return NextResponse.json({ error: opDenied.error, code: opDenied.code }, { status: opDenied.status });
  const outcome = await resumeMembershipInWorkspace({
    email,
    tenantId: admin.tenantId.trim(),
  });

  if (!outcome.ok) {
    switch (outcome.reason) {
      case "not_found":
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      case "wrong_workspace":
        return NextResponse.json({ error: "User is not in your workspace" }, { status: 404 });
      default:
        return NextResponse.json({ error: "Cannot resume user" }, { status: 400 });
    }
  }

  const ws = await prisma.workspace.findFirst({
    where: { OR: [{ id: admin.tenantId.trim() }, { slug: admin.tenantId.trim() }] },
    select: { id: true },
  });
  if (ws) {
    await writeTenantAuditLog(prisma, {
      action: "member.resume",
      actorUserId: admin.id,
      workspaceId: ws.id,
      targetUserId: outcome.userId,
      ipAddress: extractClientIp(req),
      metadata: { targetEmail: outcome.email },
    });
  }

  return NextResponse.json({ ok: true, userId: outcome.userId, email: outcome.email }, { status: 200 });
}
