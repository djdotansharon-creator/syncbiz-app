/**
 * Electron REGISTER `registrationIntent` — must stay aligned with
 * `lib/syncbiz-device-model.ts` → `registrationIntentBranchDesktopApp()`.
 * (Desktop bundle uses `rootDir: src` and cannot import the monorepo `lib/` tree.)
 */

export type SyncBizRegistrationIntent = {
  platform: "desktop";
  runtimeMode: "branch_playback";
  devicePurpose: "branch_desktop_station";
  leaseRoleHint: "none";
  contentScope: "branch";
};

/** Labels this socket as the SyncBiz Player Desktop (branch station, not browser UA). */
export function registrationIntentBranchDesktopApp(): SyncBizRegistrationIntent {
  return {
    platform: "desktop",
    runtimeMode: "branch_playback",
    devicePurpose: "branch_desktop_station",
    leaseRoleHint: "none",
    contentScope: "branch",
  };
}
