import { NextResponse } from "next/server";
import {
  getCurrentUserFromCookies,
  hasBranchAccess,
  hasTenantAdminRole,
} from "@/lib/auth-helpers";
import { DEFAULT_STREAMER_BRANCH_ID } from "@/lib/streamer-device-auth";
import { claimStreamerPairing } from "@/lib/streamer-device-store";

/** Admin/branch manager pairs a streamer code to this workspace branch. Requires user session. */
export async function POST(request: Request) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await hasTenantAdminRole(user.id);
  let body: { code?: unknown; branchId?: string; label?: string };
  try {
    body = (await request.json()) as { code?: unknown; branchId?: string; label?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const branchId = (body.branchId?.trim() || DEFAULT_STREAMER_BRANCH_ID).slice(0, 64);
  if (!isAdmin) {
    const allowed = await hasBranchAccess(user.id, branchId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await claimStreamerPairing({
      codeRaw: body.code,
      branchId,
      label: body.label,
      workspaceId: user.tenantId,
      branchUserId: user.id,
      pairedByUserId: user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
