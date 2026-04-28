import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getTenantRole } from "@/lib/user-store";
import { prisma } from "@/lib/prisma";
import {
  getWorkspaceBusinessProfileJson,
  sanitizeBusinessProfileForTenant,
  upsertWorkspaceBusinessProfile,
  validatePatchBody,
} from "@/lib/workspace-business-profile";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspaces/[workspaceId]/business-profile
 * PATCH /api/workspaces/[workspaceId]/business-profile
 *
 * Workspace members may read. WORKSPACE_ADMIN / MANAGER may write.
 * `adminNotes` is ignored on PATCH (platform route owns that field).
 */

async function assertWorkspaceMember(userId: string, workspaceId: string) {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!m || m.status === "SUSPENDED") return false;
  return true;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await context.params;
  const ok = await assertWorkspaceMember(user.id, workspaceId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const profile = await getWorkspaceBusinessProfileJson(workspaceId);
  return NextResponse.json({ profile: sanitizeBusinessProfileForTenant(profile) });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await context.params;
  const memberOk = await assertWorkspaceMember(user.id, workspaceId);
  if (!memberOk) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const role = await getTenantRole(user.id, workspaceId);
  if (role !== "TENANT_OWNER" && role !== "TENANT_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (raw && typeof raw === "object" && raw !== null && "adminNotes" in raw) {
    delete (raw as Record<string, unknown>).adminNotes;
  }

  const validated = validatePatchBody(raw, { allowAdminNotes: false });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const profile = await upsertWorkspaceBusinessProfile(workspaceId, validated.data, {
      allowAdminNotes: false,
    });
    return NextResponse.json({ profile: sanitizeBusinessProfileForTenant(profile) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
