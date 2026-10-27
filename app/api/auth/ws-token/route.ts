import { NextResponse } from "next/server";
import { resolveMintDecision } from "@/lib/device-enrollment-store";
import { restrictBranches } from "@/lib/device-enrollment";
import { shadowTokenCapabilities } from "@/lib/authz";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { createWsToken, type WsTokenClaims } from "@/lib/auth-ws-token";
import { getAuthorizedBranchIds } from "@/lib/user-store";
import { getDesignatedMastersForBranches } from "@/lib/branch-master-designation";
import { observeBranchResolutionShadow } from "@/lib/branch-resolver";

/** Returns short-lived token for WS REGISTER. Requires authenticated session. Uses stable userId. */
export async function GET(req: Request) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Authoritative branch claim, computed from the user's DB authorization — never from the client.
    const authorizedBranches = await getAuthorizedBranchIds(user.id, user.tenantId);
    shadowTokenCapabilities("auth/ws-token:GET", { userId: user.id, workspaceId: user.tenantId }, authorizedBranches); // Gate 3A shadow: log only
    const claims: WsTokenClaims = { workspaceId: user.tenantId, authorizedBranches };
    // Pilot permanent MASTER: embed the branch→designated-master map so a browser/renderer registering to a
    // designated branch is forced to CONTROL. A browser token is NEVER bound to a station (no stationDeviceId),
    // so it can never be the permanent MASTER.
    const designatedMasterByBranch = await getDesignatedMastersForBranches(user.tenantId, authorizedBranches);
    if (Object.keys(designatedMasterByBranch).length > 0) claims.designatedMasterByBranch = designatedMasterByBranch;
    // Device enrollment (dormant unless SYNCBIZ_DEVICE_ENROLLMENT=1 AND the workspace switched it on): a device that is not approved gets NO token — it can neither play nor control;
    // an approved one gets its role as a SIGNED claim (the WS server trusts that, never the client's message) and only the branches the manager approved. docs/DEVICE_ENROLLMENT_DESIGN.md §6.
    const enrollment = await resolveMintDecision({ workspaceId: user.tenantId, durableDeviceId: new URL(req.url).searchParams.get("deviceId"), userAgent: req.headers.get("user-agent") });
    if (enrollment.kind === "blocked") return NextResponse.json({ error: "enrollment_required", status: enrollment.status }, { status: 403 });
    if (enrollment.kind === "approved") {
      claims.enrollmentRole = enrollment.role;
      claims.authorizedBranches = restrictBranches(authorizedBranches, enrollment.branchIds);
    }
    const token = createWsToken(user.id, claims);
    // Control Room Phase 1 / Gate 1: SHADOW observation only (claims above are unchanged).
    void observeBranchResolutionShadow("ws-token", user.tenantId, "default");
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: "Token creation failed" }, { status: 500 });
  }
}
