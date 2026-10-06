import { NextRequest, NextResponse } from "next/server";
import { shadowAuthorize } from "@/lib/authz";
import { getCurrentUserFromCookies, isOwner } from "@/lib/auth-helpers";
import { prismaStationDeviceRepo } from "@/lib/station-device-prisma";
import {
  getBranchMasterDesignation,
  setBranchMasterDesignation,
  clearBranchMasterDesignation,
} from "@/lib/branch-master-designation";
import { syncBranchMasterDesignation } from "@/lib/broadcast-branch-master-designation";

/**
 * Pilot permanent MASTER — admin designation API (OWNER only). Minimal: no fleet UI.
 *  GET    ?branchId=…                      → current designation for (workspace, branch)
 *  POST   { branchId, durableDeviceId }    → designate/replace (durableDeviceId MUST be an active StationDevice
 *                                            bound to the SAME workspace+branch)
 *  DELETE { branchId }                     → clear (admin reset for a broken/replaced device)
 * workspaceId is ALWAYS the caller's own tenant — never accepted from the body.
 */

async function requireOwner() {
  const user = await getCurrentUserFromCookies();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await isOwner(user.id))) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

export async function GET(req: NextRequest) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const branchId = (req.nextUrl.searchParams.get("branchId") ?? "").trim();
  if (!branchId) return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  const designation = await getBranchMasterDesignation(auth.user.tenantId, branchId);
  return NextResponse.json({ designation });
}

export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  let body: { branchId?: string; durableDeviceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const branchId = (body.branchId ?? "").trim();
  const durableDeviceId = (body.durableDeviceId ?? "").trim();
  shadowAuthorize("admin/branch-master:POST", { userId: auth.user.id, workspaceId: auth.user.tenantId }, "master.designate", [branchId]); // Gate 3A shadow: log only, never blocks
  if (!branchId || !durableDeviceId) {
    return NextResponse.json({ error: "branchId and durableDeviceId are required" }, { status: 400 });
  }
  // The designated device MUST be an active StationDevice bound to the SAME (workspace, branch). This is the
  // trust anchor: we never designate an unregistered / cross-workspace / cross-branch deviceId.
  const binding = await prismaStationDeviceRepo.findByDurableId(durableDeviceId);
  if (!binding) {
    return NextResponse.json({ error: "Device is not registered as a StationDevice" }, { status: 409 });
  }
  if (binding.workspaceId !== auth.user.tenantId) {
    return NextResponse.json({ error: "Device belongs to a different workspace" }, { status: 409 });
  }
  if (binding.branchId !== branchId) {
    return NextResponse.json({ error: "Device is registered to a different branch" }, { status: 409 });
  }
  const designation = await setBranchMasterDesignation({
    workspaceId: auth.user.tenantId,
    branchId,
    durableDeviceId,
    designatedBy: auth.user.id,
  });
  // Sync the authoritative designation to the WS server (survives WS restart; stale tokens can't revert it).
  // Fail-closed: if the WS store didn't durably accept it, do NOT report success — the admin retries (idempotent).
  const synced = await syncBranchMasterDesignation({ workspaceId: auth.user.tenantId, branchId, durableDeviceId });
  if (!synced) {
    return NextResponse.json(
      { error: "Designation saved to the database but the player server did not confirm it. Please retry.", designation },
      { status: 502 },
    );
  }
  return NextResponse.json({ designation });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  let body: { branchId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const branchId = (body.branchId ?? "").trim();
  if (!branchId) return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  shadowAuthorize("admin/branch-master:DELETE", { userId: auth.user.id, workspaceId: auth.user.tenantId }, "master.designate", [branchId]); // Gate 3A shadow: log only, never blocks
  await clearBranchMasterDesignation(auth.user.tenantId, branchId);
  const synced = await syncBranchMasterDesignation({ workspaceId: auth.user.tenantId, branchId, durableDeviceId: null });
  if (!synced) {
    return NextResponse.json(
      { error: "Designation cleared in the database but the player server did not confirm it. Please retry." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
