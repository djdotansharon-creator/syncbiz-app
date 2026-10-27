import { NextResponse } from "next/server";
import { requireEnrollmentCaller } from "@/lib/device-enrollment-auth";
import { listEnrollments } from "@/lib/device-enrollment-store";

/** Control Room — the "Waiting for approval" list and the player allocation (docs/DEVICE_ENROLLMENT_DESIGN.md §5.3). Admins see everything; a branch manager sees only their own branches. */
export async function GET() {
  const auth = await requireEnrollmentCaller({ decide: true });
  if (!auth.ok) return auth.response;
  const { caller } = auth;
  const data = await listEnrollments({ workspaceId: caller.workspaceId, actor: caller.actor });
  return NextResponse.json({ ...data, actor: { isAdmin: caller.actor.isAdmin, isManager: caller.actor.isManager, isPlatformSuperAdmin: caller.isPlatformSuperAdmin } }, { headers: { "Cache-Control": "no-store" } });
}
