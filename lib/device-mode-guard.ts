/**
 * Shared guard for playback restore. When a device is in CONTROL mode,
 * local playback must not start (e.g. from persisted sessionStorage).
 * DevicePlayerProvider sets this when it receives SET_DEVICE_MODE.
 */
export const deviceModeAllowsLocalPlayback = { current: true };
