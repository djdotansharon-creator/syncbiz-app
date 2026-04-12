"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeRegistrationIntent = sanitizeRegistrationIntent;
exports.registrationIntentBranchDevice = registrationIntentBranchDevice;
exports.registrationIntentBranchDesktopApp = registrationIntentBranchDesktopApp;
exports.registrationIntentBranchController = registrationIntentBranchController;
exports.registrationIntentOwnerGlobal = registrationIntentOwnerGlobal;
exports.registrationIntentOwnerMobilePersonalPlayer = registrationIntentOwnerMobilePersonalPlayer;
exports.leaseRoleFromStationMode = leaseRoleFromStationMode;
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
/** Strips unknown values; returns undefined if invalid. Safe for untrusted WS payloads. */
function sanitizeRegistrationIntent(raw) {
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
function registrationIntentBranchDevice(isMobileUa) {
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
function registrationIntentBranchDesktopApp() {
    return {
        platform: "desktop",
        runtimeMode: "branch_playback",
        devicePurpose: "branch_desktop_station",
        leaseRoleHint: "none",
        contentScope: "branch",
    };
}
function registrationIntentBranchController(isMobileUa) {
    return {
        platform: isMobileUa ? "mobile" : "web",
        runtimeMode: "remote_control",
        devicePurpose: isMobileUa ? "branch_mobile_controller" : "branch_web_controller",
        leaseRoleHint: "none",
        contentScope: "branch",
    };
}
function registrationIntentOwnerGlobal() {
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
function registrationIntentOwnerMobilePersonalPlayer() {
    return {
        platform: "mobile",
        runtimeMode: "owner_personal_playback",
        devicePurpose: "owner_mobile_personal_player",
        leaseRoleHint: "none",
        contentScope: "owner_personal",
    };
}
/** Maps server `SET_DEVICE_MODE` to lease taxonomy (hint field uses same strings as DeviceMode + none). */
function leaseRoleFromStationMode(mode) {
    return mode;
}
