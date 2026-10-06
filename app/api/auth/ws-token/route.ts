import { NextResponse } from "next/server";
import { shadowTokenCapabilities } from "@/lib/authz";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { createWsToken, type WsTokenClaims } from "@/lib/auth-ws-token";
import { getAuthorizedBranchIds } from "@/lib/user-store";
import { getDesignatedMastersForBranches } from "@/lib/branch-master-designation";
import { observeBranchResolutionShadow } from "@/lib/branch-resolver";

/** Returns short-lived token for WS REGISTER. Requires authenticated session. Uses stable userId. */
export async function GET() {
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
    const token = createWsToken(user.id, claims);
    // Control Room Phase 1 / Gate 1: SHADOW observation only (claims above are unchanged).
    void observeBranchResolutionShadow("ws-token", user.tenantId, "default");
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: "Token creation failed" }, { status: 500 });
  }
}
