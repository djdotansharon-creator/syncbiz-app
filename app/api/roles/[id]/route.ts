import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth-helpers";
import { isRolesEnvEnabled } from "@/lib/roles";
import { RoleError, deleteRole, updateRole } from "@/lib/roles-store";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isRolesEnvEnabled()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await ctx.params;
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    await updateRole({ workspaceId: guard.workspaceId, actorUserId: guard.userId, roleId: id, input: { name: b.name, openControlRoom: b.openControlRoom, allowComputer: b.allowComputer } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RoleError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[api/roles/id] PATCH failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isRolesEnvEnabled()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id } = await ctx.params;
    await deleteRole({ workspaceId: guard.workspaceId, actorUserId: guard.userId, roleId: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RoleError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[api/roles/id] DELETE failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
