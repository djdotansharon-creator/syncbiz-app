import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";
import { getAuthorizedBranchIds } from "@/lib/user-store";
import { processStationDeviceRegister, type RegisterDeps } from "@/lib/station-device-register";
import { registerStationDeviceWithPrisma } from "@/lib/station-device-prisma";

/**
 * Phase 0.2A — POST /api/devices/register
 *
 * Authenticated self-registration of the durable MAIN (station) device identity into the cloud, bound to the
 * caller's Workspace + an authorized Branch. Bearer `desktop_access` (or session cookie) required. workspaceId
 * is derived server-side from the token/user and is never accepted from the body. See lib/station-device-*.
 */
const deps: RegisterDeps = {
  getAuthorizedBranches: (userId, workspaceId) => getAuthorizedBranchIds(userId, workspaceId),
  register: registerStationDeviceWithPrisma,
};

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromApiRequest(request);
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const { status, body: resBody } = await processStationDeviceRegister(user, body, deps);
  return NextResponse.json(resBody, { status });
}
