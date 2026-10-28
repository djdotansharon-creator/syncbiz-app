import { NextRequest, NextResponse } from "next/server";
import { requireEnrollmentCaller, clientIp } from "@/lib/device-enrollment-auth";
import { EnrollmentError, revokeEnrollment } from "@/lib/device-enrollment-store";

/** Control Room — revoke an approved device; it loses its role the next time it connects (docs/DEVICE_ENROLLMENT_DESIGN.md §5.3, §6). A manager acts only inside their own branches; audit-logged. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireEnrollmentCaller({ decide: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const note = typeof body.note === "string" ? body.note : "";
  try {
    const row = await revokeEnrollment({ workspaceId: auth.caller.workspaceId, actor: auth.caller.actor, id, note, ip: clientIp(req) });
    return NextResponse.json({ ok: true, id: row.id, status: row.status });
  } catch (e) {
    if (e instanceof EnrollmentError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[device-enrollment] revoke failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "revoke_failed" }, { status: 500 });
  }
}
