import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth-helpers";
import { isRolesEnvEnabled } from "@/lib/roles";
import { RoleError, createRole, hasCustomAccessCode, listRoles } from "@/lib/roles-store";

/** The business's roles (and whether the owner has chosen his own access code). A flag-off server answers `enabled:false` without touching the database. */
export async function GET() {
  if (!isRolesEnvEnabled()) return NextResponse.json({ enabled: false, roles: [] }, { headers: { "Cache-Control": "no-store" } });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ enabled: true, roles: await listRoles(guard.workspaceId), customCode: await hasCustomAccessCode(guard.workspaceId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/roles] GET failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isRolesEnvEnabled()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const role = await createRole({ workspaceId: guard.workspaceId, actorUserId: guard.userId, input: { name: b.name, openControlRoom: b.openControlRoom, allowComputer: b.allowComputer, permissions: b.permissions } });
    return NextResponse.json({ role }, { status: 201 });
  } catch (e) {
    if (e instanceof RoleError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[api/roles] POST failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
