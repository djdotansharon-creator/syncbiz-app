import { NextRequest, NextResponse } from "next/server";
import { requireEnrollmentCaller, clientIp } from "@/lib/device-enrollment-auth";
import { EnrollmentError, approveEnrollment } from "@/lib/device-enrollment-store";
import { validateApproveInput } from "@/lib/device-enrollment";

/** Control Room — approve a request as a Player or a Remote, with its branch scope (docs/DEVICE_ENROLLMENT_DESIGN.md §5.3). A manager acts only inside their own branches; the decision is written to the audit log. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireEnrollmentCaller({ decide: true });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const input = validateApproveInput(body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  try {
    const row = await approveEnrollment({ workspaceId: auth.caller.workspaceId, actor: auth.caller.actor, id, input: input.value, ip: clientIp(req) });
    return NextResponse.json({ ok: true, id: row.id, status: row.status });
  } catch (e) {
    if (e instanceof EnrollmentError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[device-enrollment] approve failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "approve_failed" }, { status: 500 });
  }
}
