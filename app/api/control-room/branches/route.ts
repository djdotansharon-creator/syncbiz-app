import { NextRequest, NextResponse } from "next/server";
import { requireBranchManager } from "@/lib/control-room-auth";
import { BranchInputError, createBranch } from "@/lib/branch-management";
import { EntitlementLimitError } from "@/lib/entitlement-limits";

/** Control Room — add a branch (owner only): name, branch number and a Google-picked place (resolved on the server). */
export async function POST(req: NextRequest) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const b = await createBranch(auth.workspaceId, {
      name: body.name, branchNumber: body.branchNumber, placeId: body.placeId, language: body.language, brandId: body.brandId,
    });
    return NextResponse.json({ id: b.id }, { status: 201 });
  } catch (e) {
    if (e instanceof BranchInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof EntitlementLimitError) return NextResponse.json({ error: "Your plan's branch limit has been reached." }, { status: 403 });
    console.error("[control-room/branches] create failed", e);
    return NextResponse.json({ error: "Could not create the branch." }, { status: 500 });
  }
}
