import { NextResponse } from "next/server";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";
import { isManagementLockedForRequest, managementLockedResponse } from "@/lib/management-access";
import { actorFor, loadWorkspaceFacts, updateJingleAudience } from "@/lib/jingles/library-service";
import { extractClientIp, writeTenantAuditLog } from "@/lib/admin/tenant-audit";
import { prisma } from "@/lib/prisma";

/**
 * Jingles Stage 1 (owner 2026-10-12) — change a jingle's AUDIENCE / promote it (LOCAL → BRAND / REGION /
 * BRAND_REGION / NETWORK, or UNASSIGNED → any). HQ only (access type OWNER). The SAME row is updated — same id, same
 * audio — never a copy. The workspace comes from the session. Each change is written to the workspace audit log.
 * Body: { audience, audienceBranchId?, audienceBrandId?, audienceRegion? }.
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (await isManagementLockedForRequest()) return managementLockedResponse(); // security hotfix 2026-10-13
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const facts = await loadWorkspaceFacts(user.tenantId);
  const actor = await actorFor(user.id, facts);
  const res = await updateJingleAudience(actor, facts, id, body);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  await writeTenantAuditLog(prisma, {
    action: "jingle.audience_change",
    entity: "jingle",
    actorUserId: user.id,
    workspaceId: user.tenantId,
    targetUserId: res.item.id, // AuditLog.entityId = the jingle id
    ipAddress: extractClientIp(req),
    metadata: { from: res.before, to: { audience: res.item.audience, audienceBranchId: res.item.audienceBranchId, audienceBrandId: res.item.audienceBrandId, audienceRegion: res.item.audienceRegion } },
  });
  return NextResponse.json({ item: res.item });
}
