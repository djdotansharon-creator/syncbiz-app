import { NextResponse, type NextRequest } from "next/server";
import { getDesktopUserFromApiRequest } from "@/lib/auth-helpers";
import { getAuthorizedBranchIds } from "@/lib/user-store";
import { processStationDeviceRegister, type RegisterDeps } from "@/lib/station-device-register";
import { registerStationDeviceWithPrisma } from "@/lib/station-device-prisma";
import { observeBranchResolutionShadow } from "@/lib/branch-resolver";

/**
 * Phase 0.2A — POST /api/devices/register
 *
 * Authenticated self-registration of the durable MAIN (station) device identity into the cloud, bound to the
 * caller's Workspace + an authorized Branch. DESKTOP-MAIN ONLY: requires `Authorization: Bearer <desktop_access>`
 * — no session-cookie fallback, and a `ws_register` token is rejected (→ 401). workspaceId is derived
 * server-side from the token/user and is never accepted from the body. See lib/station-device-*.
 */
const deps: RegisterDeps = {
  getAuthorizedBranches: (userId, workspaceId) => getAuthorizedBranchIds(userId, workspaceId),
  register: registerStationDeviceWithPrisma,
};

export async function POST(request: NextRequest) {
  const user = await getDesktopUserFromApiRequest(request);
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const { status, body: resBody } = await processStationDeviceRegister(user, body, deps);
  // Control Room Phase 1 / Gate 1: SHADOW observation only — registration result above is unchanged.
  if (user) {
    const rawBranch = body && typeof body === "object" ? (body as { branchId?: unknown }).branchId : undefined;
    void observeBranchResolutionShadow("devices-register", user.tenantId, typeof rawBranch === "string" ? rawBranch : "");
  }
  return NextResponse.json(resBody, { status });
}
