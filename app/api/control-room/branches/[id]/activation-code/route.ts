import { NextRequest, NextResponse } from "next/server";
import { requireBranchManager } from "@/lib/control-room-auth";
import { BranchInputError, createActivationCode, getActivationStatus, revokeActivationCode } from "@/lib/branch-management";

/**
 * Control Room — station activation code for a branch (owner only).
 *  GET    → status (Station ID, network code set?, active code expiry) — NEVER the code
 *  POST   → new one-time code (6 digits, 60 minutes); returned ONCE; the previous active code is revoked
 *  DELETE → revoke the active code
 */
type Ctx = { params: Promise<{ id: string }> };

function fail(e: unknown, what: string) {
  if (e instanceof BranchInputError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(`[control-room/activation-code] ${what} failed`, e instanceof Error ? e.message : e);
  return NextResponse.json({ error: "Could not complete the request." }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json(await getActivationStatus(auth.workspaceId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e, "status");
  }
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const created = await createActivationCode(auth.workspaceId, id, auth.userId);
    return NextResponse.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e, "create");
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await revokeActivationCode(auth.workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, "revoke");
  }
}
