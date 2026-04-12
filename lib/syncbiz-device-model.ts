/**
 * SyncBiz device / content taxonomy — explicit separation of concerns for:
 * - Branch station playback (desktop MASTER/CONTROL, WS "device" role)
 * - Branch remote control (WS "controller" role — phone or browser)
 * - Owner mobile personal playback (local-only today; not the branch station model)
 * - Owner global dashboard (WS "owner_global")
 *
 * This module is intentionally free of React and does not import `remote-control/types`
 * to avoid circular imports (`types.ts` imports registration shapes from here).
 */

/** Where the client UI/runtime is hosted. */
export type SyncBizPlatform = "desktop" | "mobile" | "web";

/**
 * What the client is doing in this session (orthogonal to WS `ClientRole` string).
 * - `remote_control` — send commands to branch MASTER; no local branch playback authority.
 * - `branch_playback` — participates in branch station sync (MASTER or CONTROL lease).
 * - `owner_personal_playback` — OWNER-only autonomous playback (personal library); not branch station.
 */
export type SyncBizRuntimeMode = "remote_control" | "branch_playback" | "owner_personal_playback";

/**
 * Product-level purpose — distinguishes branch desktop from owner mobile personal, etc.
 */
export type SyncBizDevicePurpose =
  | "branch_desktop_station"
  | "branch_web_station"
  | "branch_mobile_controller"
  | "branch_web_controller"
  | "owner_mobile_personal_player"
  | "owner_global_branch_dashboard";

/**
 * Branch lease from WS server (`SET_DEVICE_MODE`). Not applicable for pure controllers or personal-only playback.
 */
export type SyncBizLeaseRole = "MASTER" | "CONTROL" | "none";

/**
 * Which content namespace APIs and UI should prefer.
 * - `branch` — tenant branch catalog (shared station context).
 * - `owner_personal` — OWNER private playlists / URL bank (future: enforce server-side for OWNER only).
 * - `not_applicable` — e.g. owner_global branch picker before a branch is selected.
 */
export type SyncBizContentScope = "branch" | "owner_personal" | "not_applicable";

/** Optional client hint on REGISTER — server may log, echo in DEVICE_LIST; does not replace auth. */
export type SyncBizRegistrationIntent = {
  platform: SyncBizPlatform;
  runtimeMode: SyncBizRuntimeMode;
  devicePurpose: SyncBizDevicePurpose;
  /**
   * Client-side expectation before SET_DEVICE_MODE. Controllers and personal players use `none`.
   * Server-assigned lease remains authoritative.
   */
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

/** Strips unknown values; returns undefined if invalid. Safe for untrusted WS payloads. */
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

export function registrationIntentBranchDevice(isMobileUa: boolean): SyncBizRegistrationIntent {
  if (isMobileUa) {
    return {
      platform: "mobile",
      runtimeMode: "branch_playback",
      devicePurpose: "branch_web_station",
      leaseRoleHint: "none",
      contentScope: "branch",
    };
  }
  return {
    platform: "web",
    runtimeMode: "branch_playback",
    devicePurpose: "branch_web_station",
    leaseRoleHint: "none",
    contentScope: "branch",
  };
}

/** Electron / future native desktop — not inferred from UA; call site sets platform `desktop`. */
export function registrationIntentBranchDesktopApp(): SyncBizRegistrationIntent {
  return {
    platform: "desktop",
    runtimeMode: "branch_playback",
    devicePurpose: "branch_desktop_station",
    leaseRoleHint: "none",
    contentScope: "branch",
  };
}

export function registrationIntentBranchController(isMobileUa: boolean): SyncBizRegistrationIntent {
  return {
    platform: isMobileUa ? "mobile" : "web",
    runtimeMode: "remote_control",
    devicePurpose: isMobileUa ? "branch_mobile_controller" : "branch_web_controller",
    leaseRoleHint: "none",
    contentScope: "branch",
  };
}

export function registrationIntentOwnerGlobal(): SyncBizRegistrationIntent {
  return {
    platform: "web",
    runtimeMode: "remote_control",
    devicePurpose: "owner_global_branch_dashboard",
    leaseRoleHint: "none",
    contentScope: "not_applicable",
  };
}

/**
 * OWNER mobile — local personal player: no branch WS device registration in current architecture.
 * Use for UI/guardrails and future APIs; WS REGISTER for branch is not used in this mode.
 */
export function registrationIntentOwnerMobilePersonalPlayer(): SyncBizRegistrationIntent {
  return {
    platform: "mobile",
    runtimeMode: "owner_personal_playback",
    devicePurpose: "owner_mobile_personal_player",
    leaseRoleHint: "none",
    contentScope: "owner_personal",
  };
}

/** Maps server `SET_DEVICE_MODE` to lease taxonomy (hint field uses same strings as DeviceMode + none). */
export function leaseRoleFromStationMode(mode: "MASTER" | "CONTROL"): SyncBizLeaseRole {
  return mode;
}
