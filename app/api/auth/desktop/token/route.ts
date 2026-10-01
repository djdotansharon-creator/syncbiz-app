import { NextRequest, NextResponse } from "next/server";
import { validateCredentialsAsync } from "@/lib/auth";
import { getOrCreateUserByEmail } from "@/lib/user-store";
import { createDesktopAccessToken, getDesktopTokenTtlSeconds, type WsTokenClaims } from "@/lib/auth-ws-token";
import { getAuthorizedBranchIds } from "@/lib/user-store";
import { prismaStationDeviceRepo } from "@/lib/station-device-prisma";
import { getDesignatedMastersForBranches } from "@/lib/branch-master-designation";
import { emitEvent, EVENT_TYPES } from "@/lib/analytics-boundary";

/**
 * Email/password → long-lived `desktop_access` bearer token (no session cookie).
 * Used by Electron desktop; same token works for HTTP Bearer and WS REGISTER.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, deviceId } = body as { email?: string; password?: string; deviceId?: string };

    if (!email?.trim() || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    if (!(await validateCredentialsAsync(email, password))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const user = await getOrCreateUserByEmail(email);
    emitEvent(EVENT_TYPES.USER_LOGIN, { userId: user.id, email: user.email, via: "desktop_token" });

    const ttlSec = getDesktopTokenTtlSeconds();
    // Authoritative branch claim, computed from the user's DB authorization — never from the client.
    const authorizedBranches = await getAuthorizedBranchIds(user.id, user.tenantId);

    const claims: WsTokenClaims = { workspaceId: user.tenantId, authorizedBranches };
    // Pilot permanent MASTER: bind the token to the durable station ONLY when the supplied deviceId is a
    // StationDevice registered to THIS workspace (never trust the raw client value). This is what later lets the
    // WS server accept this exact device as the permanent MASTER.
    const durableDeviceId = typeof deviceId === "string" ? deviceId.trim() : "";
    if (durableDeviceId) {
      const binding = await prismaStationDeviceRepo.findByDurableId(durableDeviceId);
      if (binding && binding.workspaceId === user.tenantId) {
        claims.stationDeviceId = durableDeviceId;
      }
    }
    // Embed the branch→designated-master map for the authorized branches (presence tells the WS server a branch
    // is permanently designated). Computed from the DB at mint so it survives WS/server restart via the claim.
    const designatedMasterByBranch = await getDesignatedMastersForBranches(user.tenantId, authorizedBranches);
    if (Object.keys(designatedMasterByBranch).length > 0) claims.designatedMasterByBranch = designatedMasterByBranch;

    const token = createDesktopAccessToken(user.id, claims);
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();

    return NextResponse.json({ token, expiresAt, expiresInSec: ttlSec });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("SYNCBIZ_WS_SECRET") || msg.includes("WS_SECRET")) {
      return NextResponse.json({ error: "Server token signing is not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
