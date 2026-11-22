import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies, getAssignedBranchIdsForUser } from "@/lib/auth-helpers";
import { listSharesForBranches, workspaceBranchIds } from "@/lib/playlist-share-store";
import type { ShareStatus } from "@/lib/playlist-share-rules";

/**
 * The shares waiting for (or accepted by) the branches the caller may use — what the request card and the shared-in part of the library read (owner 2026-11-22, phase C).
 *   ?status=pending (default) | accepted | all     ?branchId=<id>  (one branch; must be one the caller may use)
 * Answers only inside the caller's own business.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = (user.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });

  const s = (req.nextUrl.searchParams.get("status") ?? "pending").toLowerCase();
  const statuses: ShareStatus[] = s === "accepted" ? ["ACCEPTED"] : s === "all" ? ["PENDING", "ACCEPTED"] : ["PENDING"];
  const one = (req.nextUrl.searchParams.get("branchId") ?? "").trim();
  try {
    const [access, wsBranches] = await Promise.all([getAssignedBranchIdsForUser(user.id, tenantId), workspaceBranchIds(tenantId)]);
    const allAccess = access.includes("*");
    let branchIds: string[] | "*";
    if (one) {
      if (!wsBranches.includes(one)) return NextResponse.json({ error: "Unknown branch" }, { status: 404 });
      if (!allAccess && !access.includes(one)) return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
      branchIds = [one];
    } else {
      branchIds = allAccess ? "*" : access.filter((b) => wsBranches.includes(b));
    }
    return NextResponse.json(await listSharesForBranches({ workspaceId: tenantId, branchIds, statuses }));
  } catch (e) {
    console.error("[api/playlist-shares] GET error:", e);
    return NextResponse.json({ error: "Failed to list shares" }, { status: 500 });
  }
}
