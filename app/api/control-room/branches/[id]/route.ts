import { NextRequest, NextResponse } from "next/server";
import { requireBranchManager } from "@/lib/control-room-auth";
import { BranchInputError, deleteBranch, updateBranch } from "@/lib/branch-management";

/** Control Room — edit a branch (owner only). The location changes only when a new Google place was picked. */
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
      name: body.name, branchNumber: body.branchNumber, placeId: body.placeId, language: body.language, brandId: body.brandId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BranchInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[control-room/branches] update failed", e);
    return NextResponse.json({ error: "Could not save the branch." }, { status: 500 });
  }
}

/** Control Room — delete (a branch) of THIS organization (owner only). Refusals answer 409 with a `code` the screen words itself. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteBranch(auth.workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BranchInputError) return NextResponse.json({ error: e.message, code: e.code, count: e.count }, { status: e.status });
    console.error("[control-room/branches] delete failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }
}
