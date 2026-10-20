import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { db } from "@/lib/store";
import { BranchInputError } from "@/lib/branch-management";
import { getStationActivationState, isPlausibleDurableDeviceId, redeemStationActivation } from "@/lib/station-activation";
import { syncBranchMasterDesignation } from "@/lib/broadcast-branch-master-designation";

/**
 * Station activation (Step B1) — called by the VONO desktop app on THIS computer.
 *  GET  ?deviceId=…                        → { designated, branchName?, stationId? } (is this computer a main station?)
 *  POST { stationId, code, deviceId, appVersion? } → binds this computer to that branch as its main station
 * B1: requires a signed-in session of the same organization (temporary); the one-time code is the authorization.
 */

async function sessionWorkspace(): Promise<{ ok: true; userId: string; workspaceId: string } | { ok: false; response: NextResponse }> {
  const user = await getCurrentUserFromCookies();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const workspaceId = await db.resolveWorkspaceIdForAccount(user.tenantId === "tnt-default" ? "acct-demo-001" : user.tenantId);
  // the WS designation + desktop token claims are keyed by the session tenant — both must be the same organization
  if (!workspaceId || workspaceId !== user.tenantId) return { ok: false, response: NextResponse.json({ error: "Workspace not found" }, { status: 404 }) };
  return { ok: true, userId: user.id, workspaceId };
}

export async function GET(req: NextRequest) {
  const auth = await sessionWorkspace();
  if (!auth.ok) return auth.response;
  const deviceId = (req.nextUrl.searchParams.get("deviceId") ?? "").trim();
  if (!isPlausibleDurableDeviceId(deviceId)) return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  return NextResponse.json(await getStationActivationState(auth.workspaceId, deviceId), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await sessionWorkspace();
  if (!auth.ok) return auth.response;
  let body: { stationId?: unknown; code?: unknown; deviceId?: unknown; appVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const r = await redeemStationActivation({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      stationId: body.stationId,
      code: body.code,
      durableDeviceId: body.deviceId,
      appVersion: body.appVersion,
    });
    // Tell the player server (survives a WS restart; demotes a replaced station). The DB designation is already the
    // truth; if the server did not confirm, the station still becomes MAIN from its signed token on a fresh branch.
    const synced = r.alreadyActive ? true : await syncBranchMasterDesignation({ workspaceId: auth.workspaceId, branchId: r.designationBranchId, durableDeviceId: r.durableDeviceId });
    console.info("[stations/activate] station activated", JSON.stringify({ stationId: r.stationId, branchId: r.branchId, replaced: r.replaced, alreadyActive: r.alreadyActive, synced }));
    return NextResponse.json(
      { branchId: r.branchId, branchName: r.branchName, stationId: r.stationId, replaced: r.replaced, alreadyActive: r.alreadyActive, synced },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof BranchInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[stations/activate] failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not activate the station. Please try again." }, { status: 500 });
  }
}
