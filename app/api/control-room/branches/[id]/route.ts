import { NextRequest, NextResponse } from "next/server";
import { requireBranchManager } from "@/lib/control-room-auth";
import { BranchInputError, updateBranch } from "@/lib/branch-management";

/** Control Room — edit a branch (owner only). The address is geocoded again when it changes (exact or error). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    await updateBranch(auth.workspaceId, id, {
      name: body.name, branchNumber: body.branchNumber, country: body.country, city: body.city, street: body.street, houseNumber: body.houseNumber,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BranchInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[control-room/branches] update failed", e);
    return NextResponse.json({ error: "Could not save the branch." }, { status: 500 });
  }
}
