import { NextResponse } from "next/server";
import { requireWorkspaceAdmin } from "@/lib/auth-helpers";
import { listPeople } from "@/lib/people-store";

/** The people of the business (workspace admin only): name, level, role, state, last sign-in. */
export async function GET() {
  const guard = await requireWorkspaceAdmin();
  if (!guard) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ people: await listPeople(guard.workspaceId, guard.userId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/people] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
