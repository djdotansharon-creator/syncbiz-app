/**
 * Prisma-wired wrapper for the desktop auth bind helper. The routes call this; it registers the StationDevice
 * (race-safe, idempotent) FIRST, then builds the desktop_access claims (see station-device-bind.ts).
 */
import { registerStationDeviceWithPrisma } from "@/lib/station-device-prisma";
import { getDesignatedMastersForBranches } from "@/lib/branch-master-designation";
import { buildDesktopAuthClaims, type BuildClaimsInput, type DesktopAuthClaims } from "@/lib/station-device-bind";
import { canonicalizeLegacyBranch, getCanonicalLegacyBranchId } from "@/lib/branch-resolver";

export function ensureStationBoundAndBuildClaims(input: BuildClaimsInput): Promise<DesktopAuthClaims> {
  return buildDesktopAuthClaims(input, {
    register: (i) => registerStationDeviceWithPrisma(i),
    getDesignatedMasters: (ws, branches) => getDesignatedMastersForBranches(ws, branches),
    // Gate 2A-1: signed stationBranchId in canonical form ("default" → the workspace's canonical Branch).
    canonicalizeBranch: async (ws, branchId) => canonicalizeLegacyBranch(branchId, await getCanonicalLegacyBranchId(ws)),
  });
}
