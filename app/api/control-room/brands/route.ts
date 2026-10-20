import { NextRequest, NextResponse } from "next/server";
import { requireBranchManager } from "@/lib/control-room-auth";
import { BranchInputError } from "@/lib/branch-management";
import { createBrand, listBrands } from "@/lib/brand-management";

/**
 * Control Room — brands (owner only).
 *  GET  → { brands, defaultBrandId, branchBrand: { branchId → brandId } } (a branch with no brand → the default Brand)
 *  POST { name, code, color } → new brand of THIS organization
 */
export async function GET() {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await listBrands(auth.workspaceId), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[control-room/brands] list failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not load brands." }, { status: 500 });
  }
}

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
    const b = await createBrand(auth.workspaceId, { name: body.name, code: body.code, color: body.color });
    return NextResponse.json({ id: b.id }, { status: 201 });
  } catch (e) {
    if (e instanceof BranchInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[control-room/brands] create failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not create the brand." }, { status: 500 });
  }
}
