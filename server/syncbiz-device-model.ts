/**
 * Server-local device intent sanitizer.
 * Keep this module in `server/` so it is emitted with the same ESM format as `server/index.ts`.
 */

export type SyncBizPlatform = "desktop" | "mobile" | "web";
export type SyncBizRuntimeMode = "remote_control" | "branch_playback" | "owner_personal_playback";
export type SyncBizDevicePurpose =
  | "branch_desktop_station"
  | "branch_web_station"
  | "branch_mobile_controller"
  | "branch_web_controller"
  | "owner_mobile_personal_player"
  | "owner_global_branch_dashboard";
export type SyncBizLeaseRole = "MASTER" | "CONTROL" | "none";
export type SyncBizContentScope = "branch" | "owner_personal" | "not_applicable";

export type SyncBizRegistrationIntent = {
  platform: SyncBizPlatform;
  runtimeMode: SyncBizRuntimeMode;
  devicePurpose: SyncBizDevicePurpose;
  leaseRoleHint: SyncBizLeaseRole;
  contentScope: SyncBizContentScope;
};

const PLATFORMS = new Set<SyncBizPlatform>(["desktop", "mobile", "web"]);
const RUNTIMES = new Set<SyncBizRuntimeMode>(["remote_control", "branch_playback", "owner_personal_playback"]);
const PURPOSES = new Set<SyncBizDevicePurpose>([
  "branch_desktop_station",
  "branch_web_station",
  "branch_mobile_controller",
  "branch_web_controller",
  "owner_mobile_personal_player",
  "owner_global_branch_dashboard",
]);
const LEASES = new Set<SyncBizLeaseRole>(["MASTER", "CONTROL", "none"]);
const SCOPES = new Set<SyncBizContentScope>(["branch", "owner_personal", "not_applicable"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function sanitizeRegistrationIntent(raw: unknown): SyncBizRegistrationIntent | undefined {
  if (!isRecord(raw)) return undefined;
  const platform = raw.platform;
  const runtimeMode = raw.runtimeMode;
  const devicePurpose = raw.devicePurpose;
  const leaseRoleHint = raw.leaseRoleHint;
  const contentScope = raw.contentScope;
  if (
    typeof platform === "string" &&
    PLATFORMS.has(platform as SyncBizPlatform) &&
    typeof runtimeMode === "string" &&
    RUNTIMES.has(runtimeMode as SyncBizRuntimeMode) &&
    typeof devicePurpose === "string" &&
    PURPOSES.has(devicePurpose as SyncBizDevicePurpose) &&
    typeof leaseRoleHint === "string" &&
    LEASES.has(leaseRoleHint as SyncBizLeaseRole) &&
    typeof contentScope === "string" &&
    SCOPES.has(contentScope as SyncBizContentScope)
  ) {
    return {
      platform: platform as SyncBizPlatform,
      runtimeMode: runtimeMode as SyncBizRuntimeMode,
      devicePurpose: devicePurpose as SyncBizDevicePurpose,
      leaseRoleHint: leaseRoleHint as SyncBizLeaseRole,
      contentScope: contentScope as SyncBizContentScope,
    };
  }
  return undefined;
}
