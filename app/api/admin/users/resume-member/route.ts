/**
 * Re-activates a previously paused workspace membership
 * (`WorkspaceMember.status = ACTIVE`). Idempotent — already-active memberships
 * succeed without side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-helpers";
import { resumeMembershipInWorkspace } from "@/lib/user-store";
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
