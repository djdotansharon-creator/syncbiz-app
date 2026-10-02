/**
 * Shared "register FIRST, then build desktop_access claims" PURE core for the desktop auth routes.
 *
 * Both desktop-token routes call this (via the Prisma wrapper in station-device-bind-prisma.ts) so a token is
 * minted ONLY AFTER the StationDevice row is ensured — eliminating the former "second sign-in needed to bind"
 * race. If (and only if) the device is now a StationDevice legitimately bound to this (workspace, branch), the
 * token carries `stationDeviceId`; on any conflict it is omitted. `designatedMasterByBranch` is always computed.
 *
 * This file imports nothing stateful (no Prisma) so it is unit-testable with injected deps.
 */
import { isValidDurableDeviceId, type RegisterOutcome, type RegisterStationDeviceInput } from "@/lib/station-device-store";

const DEFAULT_BRANCH_ID = "default";

export type DesktopAuthClaims = { stationDeviceId?: string; designatedMasterByBranch?: Record<string, string> };

export type BuildClaimsInput = {
  workspaceId: string;
  authorizedBranches: string[];
  deviceId?: string | null;
  branchId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
};

export type BuildClaimsDeps = {
  /** Register (idempotent, race-safe) the StationDevice; returns the outcome. */
  register: (input: RegisterStationDeviceInput) => Promise<{ outcome: RegisterOutcome }>;
  /** Branch → designated durable deviceId map for the given branches. */
  getDesignatedMasters: (workspaceId: string, branchIds: string[]) => Promise<Record<string, string>>;
};

/**
 * Registers the StationDevice FIRST (when a valid, authorized deviceId+branch is supplied), then builds claims.
 * `stationDeviceId` is set ONLY on a created/refreshed outcome (device owns this ws+branch); a branch/workspace
 * conflict leaves it unset. Never throws for a missing/invalid deviceId — it just omits the binding.
 */
export async function buildDesktopAuthClaims(input: BuildClaimsInput, deps: BuildClaimsDeps): Promise<DesktopAuthClaims> {
  const claims: DesktopAuthClaims = {};
  const durable = typeof input.deviceId === "string" ? input.deviceId.trim() : "";
  const branchId = (typeof input.branchId === "string" ? input.branchId.trim() : "") || DEFAULT_BRANCH_ID;

  if (durable && isValidDurableDeviceId(durable) && input.authorizedBranches.includes(branchId)) {
    const platform = typeof input.platform === "string" && input.platform.trim() ? input.platform.trim() : "unknown";
    const appVersion = typeof input.appVersion === "string" && input.appVersion.trim() ? input.appVersion.trim() : "unknown";
    // REGISTER FIRST so the token minted afterwards can carry a verified binding.
    const result = await deps.register({ durableDeviceId: durable, workspaceId: input.workspaceId, branchId, platform, appVersion });
    if (result.outcome === "created" || result.outcome === "refreshed") {
      claims.stationDeviceId = durable; // device legitimately bound to THIS workspace+branch
    }
    // branch_conflict / workspace_conflict → do NOT bind the token to a device the caller doesn't own.
  }

  const designated = await deps.getDesignatedMasters(input.workspaceId, input.authorizedBranches);
  if (Object.keys(designated).length > 0) claims.designatedMasterByBranch = designated;
  return claims;
}
