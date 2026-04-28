import { NextRequest, NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import {
  getWorkspaceBusinessProfileJson,
  upsertWorkspaceBusinessProfile,
  validatePatchBody,
} from "@/lib/workspace-business-profile";

export const dynamic = "force-dynamic";

/**
 * GET/PATCH /api/admin/platform/workspaces/[id]/business-profile
 *
 * Platform SUPER_ADMIN only. Full profile including `adminNotes`.
 */

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: workspaceId } = await context.params;

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const profile = await getWorkspaceBusinessProfileJson(workspaceId);
  return NextResponse.json({ profile });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: workspaceId } = await context.params;

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validatePatchBody(raw, { allowAdminNotes: true });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const profile = await upsertWorkspaceBusinessProfile(workspaceId, validated.data, {
      allowAdminNotes: true,
    });
    return NextResponse.json({ profile });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
