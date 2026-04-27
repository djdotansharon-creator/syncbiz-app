/**
 * Pure helpers for platform-admin “over quota” visibility (counts vs
 * `WorkspaceEntitlement` limits). No enforcement — UI only.
 */

export type QuotaKey = "branches" | "devices" | "users" | "playlists";

export type QuotaCheck = {
  key: QuotaKey;
  /** Short label for compact badges, e.g. "B" */
  short: string;
  /** Human label for drill-down */
  label: string;
  current: number;
  max: number;
  over: boolean;
};

export type EntitlementMaxes = {
  maxBranches: number;
  maxDevices: number;
  maxUsers: number;
  maxPlaylists: number;
};

export type WorkspaceResourceCounts = {
  branches: number;
  devices: number;
  members: number;
  playlists: number;
};

/**
 * Returns per-dimension OK/over state. If there is no entitlement row,
 * returns empty checks and `hasEntitlement: false` (UI should not imply over-quota).
 */
export function buildQuotaChecks(
  entitlement: EntitlementMaxes | null | undefined,
  counts: WorkspaceResourceCounts,
): { hasEntitlement: boolean; checks: QuotaCheck[]; anyOver: boolean } {
  if (!entitlement) {
    return { hasEntitlement: false, checks: [], anyOver: false };
  }
  const { maxBranches, maxDevices, maxUsers, maxPlaylists } = entitlement;
  const checks: QuotaCheck[] = [
    {
      key: "branches",
      short: "B",
      label: "Branches",
      current: counts.branches,
      max: maxBranches,
      over: counts.branches > maxBranches,
    },
    {
      key: "devices",
      short: "D",
      label: "Devices",
      current: counts.devices,
      max: maxDevices,
      over: counts.devices > maxDevices,
    },
    {
      key: "users",
      short: "U",
      label: "Users",
      current: counts.members,
      max: maxUsers,
      over: counts.members > maxUsers,
    },
    {
      key: "playlists",
      short: "P",
      label: "Playlists",
      current: counts.playlists,
      max: maxPlaylists,
      over: counts.playlists > maxPlaylists,
    },
  ];
  return {
    hasEntitlement: true,
    checks,
    anyOver: checks.some((c) => c.over),
  };
}
