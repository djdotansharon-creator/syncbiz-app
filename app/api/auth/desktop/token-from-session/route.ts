import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { createDesktopAccessToken, getDesktopTokenTtlSeconds, type WsTokenClaims } from "@/lib/auth-ws-token";
import { getAuthorizedBranchIds } from "@/lib/user-store";
import { ensureStationBoundAndBuildClaims } from "@/lib/station-device-bind-prisma";

/**
 * SESSION → bound desktop_access token (no password re-entry). Lets a user who signed in ONCE through the normal
 * hosted VONO login have the Electron MAIN process obtain a desktop_access token automatically.
 *
 * Authenticated by the `syncbiz-session` cookie (same trust as /api/auth/ws-token). The Electron renderer POSTs
 * same-origin with the MAIN durable deviceId; the server ensures the StationDevice FIRST, then mints a token that
 * already carries stationDeviceId + designatedMasterByBranch (so NO second sign-in is needed). The durable
 * deviceId is validated as a StationDevice bound to THIS workspace+branch before it is embedded — a raw client
 * value can never bind to a workspace/branch it doesn't own. workspaceId is always the caller's own tenant.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    let body: { deviceId?: string; branchId?: string; platform?: string; appVersion?: string };
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const authorizedBranches = await getAuthorizedBranchIds(user.id, user.tenantId);
    const bound = await ensureStationBoundAndBuildClaims({
      workspaceId: user.tenantId,
      authorizedBranches,
      deviceId: body.deviceId,
      branchId: body.branchId,
      platform: body.platform,
      appVersion: body.appVersion,
    });
    const claims: WsTokenClaims = { workspaceId: user.tenantId, authorizedBranches, ...bound };
    const ttlSec = getDesktopTokenTtlSeconds();
    const token = createDesktopAccessToken(user.id, claims);
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
    return NextResponse.json({ token, expiresAt, expiresInSec: ttlSec, bound: Boolean(bound.stationDeviceId) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("SYNCBIZ_WS_SECRET") || msg.includes("WS_SECRET")) {
      return NextResponse.json({ error: "Server token signing is not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not issue desktop token" }, { status: 500 });
  }
}
