import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth-helpers";
import { isRolesEnvEnabled } from "@/lib/roles";
import { RoleError, assignRoleToMember } from "@/lib/roles-store";

/** Give an existing person another of the owner's roles (roles on only). The owner's own level and workspace admins are never changed here. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  if (!isRolesEnvEnabled()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { userId } = await ctx.params;
    const b = (await req.json().catch(() => ({}))) as { roleId?: unknown };
    await assignRoleToMember({ workspaceId: guard.workspaceId, actorUserId: guard.userId, userId, roleId: typeof b.roleId === "string" ? b.roleId : "" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RoleError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[api/people/role] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
