import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth-helpers";
import { isRolesEnvEnabled } from "@/lib/roles";
import { RoleError, setWorkspaceAccessCode } from "@/lib/roles-store";

/** The owner chooses his own access code for Settings on the player computer (3–12 letters / digits). */
export async function POST(req: NextRequest) {
  if (!isRolesEnvEnabled()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const b = (await req.json().catch(() => ({}))) as { code?: unknown };
    await setWorkspaceAccessCode({ workspaceId: guard.workspaceId, actorUserId: guard.userId, code: b.code });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RoleError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[api/roles/access-code] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
