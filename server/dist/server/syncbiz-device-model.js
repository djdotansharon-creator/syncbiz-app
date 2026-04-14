/**
 * Server-local device intent sanitizer.
 * Keep this module in `server/` so it is emitted with the same ESM format as `server/index.ts`.
 */
const PLATFORMS = new Set(["desktop", "mobile", "web"]);
const RUNTIMES = new Set(["remote_control", "branch_playback", "owner_personal_playback"]);
const PURPOSES = new Set([
    "branch_desktop_station",
    "branch_web_station",
    "branch_mobile_controller",
    "branch_web_controller",
    "owner_mobile_personal_player",
    "owner_global_branch_dashboard",
]);
const LEASES = new Set(["MASTER", "CONTROL", "none"]);
const SCOPES = new Set(["branch", "owner_personal", "not_applicable"]);
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function sanitizeRegistrationIntent(raw) {
    if (!isRecord(raw))
        return undefined;
    const platform = raw.platform;
    const runtimeMode = raw.runtimeMode;
    const devicePurpose = raw.devicePurpose;
    const leaseRoleHint = raw.leaseRoleHint;
    const contentScope = raw.contentScope;
    if (typeof platform === "string" &&
        PLATFORMS.has(platform) &&
        typeof runtimeMode === "string" &&
        RUNTIMES.has(runtimeMode) &&
        typeof devicePurpose === "string" &&
        PURPOSES.has(devicePurpose) &&
        typeof leaseRoleHint === "string" &&
        LEASES.has(leaseRoleHint) &&
        typeof contentScope === "string" &&
        SCOPES.has(contentScope)) {
        return {
            platform: platform,
            runtimeMode: runtimeMode,
            devicePurpose: devicePurpose,
            leaseRoleHint: leaseRoleHint,
            contentScope: contentScope,
        };
    }
    return undefined;
}
