/**
 * Phase 0.2A — pure request→response decision for POST /api/devices/register.
 *
 * No HTTP / Prisma imports: takes the resolved user, the parsed body, and injectable deps, and returns a plain
 * { status, body }. The route adapter wires the real deps; tests inject fakes. workspaceId is ALWAYS taken from
 * the authenticated user (server-authoritative) — request body workspaceId is never read.
 */
import {
  isValidDurableDeviceId,
  type RegisterResult,
  type RegisterStationDeviceInput,
} from "@/lib/station-device-store";

const DEFAULT_BRANCH_ID = "default";
const PLATFORM_MAX = 120;
const APP_VERSION_MAX = 60;

type MinimalUser = { id: string; tenantId: string };

export type RegisterDeps = {
  /** Authoritative authorized branch ids for (userId, workspaceId), recomputed from the DB. */
  getAuthorizedBranches: (userId: string, workspaceId: string) => Promise<string[]>;
  /** Persist the registration (race-safe, cross-tenant-safe). */
  register: (input: RegisterStationDeviceInput) => Promise<RegisterResult>;
};

export type RegisterResponse = { status: number; body: Record<string, unknown> };

export async function processStationDeviceRegister(
  user: MinimalUser | null,
  body: unknown,
  deps: RegisterDeps,
): Promise<RegisterResponse> {
  if (!user) return { status: 401, body: { error: "Unauthorized" } };
  if (!body || typeof body !== "object") return { status: 400, body: { error: "Invalid request body" } };

  const b = body as Record<string, unknown>;
  if (!isValidDurableDeviceId(b.durableDeviceId)) {
    return { status: 400, body: { error: "invalid durableDeviceId" } };
  }
  const durableDeviceId = b.durableDeviceId.trim();
  const branchIn = typeof b.branchId === "string" ? b.branchId.trim() : "";
  const requestedBranch = branchIn || DEFAULT_BRANCH_ID;
  const platform =
    typeof b.platform === "string" && b.platform.trim() ? b.platform.trim().slice(0, PLATFORM_MAX) : "unknown";
  const appVersion =
    typeof b.appVersion === "string" && b.appVersion.trim() ? b.appVersion.trim().slice(0, APP_VERSION_MAX) : "unknown";

  // SERVER-AUTHORITATIVE workspace — request body workspaceId is intentionally ignored.
  const workspaceId = user.tenantId;

  const authorized = await deps.getAuthorizedBranches(user.id, workspaceId);
  if (!authorized.includes(requestedBranch)) {
    return { status: 403, body: { error: "branch not authorized" } };
  }

  const result = await deps.register({
    durableDeviceId,
    workspaceId,
    branchId: requestedBranch,
    platform,
    appVersion,
  });

  switch (result.outcome) {
    case "created":
      return { status: 201, body: { status: "registered" } };
    case "refreshed":
      return { status: 200, body: { status: "refreshed" } };
    case "branch_conflict":
      return { status: 409, body: { error: "device is registered to a different branch" } };
    case "workspace_conflict":
      // Do not reveal the owning workspace.
      return { status: 409, body: { error: "device is registered to another workspace" } };
  }
}
