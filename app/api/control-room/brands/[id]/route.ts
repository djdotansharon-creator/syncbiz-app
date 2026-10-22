import { NextRequest, NextResponse } from "next/server";
import { requireBranchManager } from "@/lib/control-room-auth";
import { BranchInputError } from "@/lib/branch-management";
import { updateBrand } from "@/lib/brand-management";

/** Control Room — edit a brand of THIS organization (owner only): name, code, color. */
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
    await updateBrand(auth.workspaceId, id, { name: body.name, code: body.code, color: body.color });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BranchInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[control-room/brands] update failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not save the brand." }, { status: 500 });
  }
}
