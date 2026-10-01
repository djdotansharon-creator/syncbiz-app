import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { createWsToken, type WsTokenClaims } from "@/lib/auth-ws-token";
import { getAuthorizedBranchIds } from "@/lib/user-store";
import { getDesignatedMastersForBranches } from "@/lib/branch-master-designation";

/** Returns short-lived token for WS REGISTER. Requires authenticated session. Uses stable userId. */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Authoritative branch claim, computed from the user's DB authorization — never from the client.
    const authorizedBranches = await getAuthorizedBranchIds(user.id, user.tenantId);
    const claims: WsTokenClaims = { workspaceId: user.tenantId, authorizedBranches };
    // Pilot permanent MASTER: embed the branch→designated-master map so a browser/renderer registering to a
    // designated branch is forced to CONTROL. A browser token is NEVER bound to a station (no stationDeviceId),
    // so it can never be the permanent MASTER.
    const designatedMasterByBranch = await getDesignatedMastersForBranches(user.tenantId, authorizedBranches);
    if (Object.keys(designatedMasterByBranch).length > 0) claims.designatedMasterByBranch = designatedMasterByBranch;
    const token = createWsToken(user.id, claims);
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: "Token creation failed" }, { status: 500 });
  }
}
