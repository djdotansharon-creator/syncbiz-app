/**
 * Shared guard for playback restore. When a device is in CONTROL mode,
 * local playback must not start (e.g. from persisted sessionStorage).
 * DevicePlayerProvider sets this when it receives SET_DEVICE_MODE.
 */
export const deviceModeAllowsLocalPlayback = { current: true };

/**
 * SECOND, FAIL-CLOSED permission (approach b): allow LOCAL-source playback on the DESIGNATED-MASTER machine
 * even while the hosted renderer is CONTROL (its co-located Electron MAIN is the real MASTER). Set true ONLY
 * from `canLocalExec` (isElectronShell && the MAIN's `commandReady`). Default false. It is ALWAYS checked
 * together with a local-source test in PlaybackProvider, so URL / radio / YouTube are never affected, and a
 * non-designated / CONTROL / offline device (commandReady=false) stays fully blocked.
 */
export const localSourceExecAllowed = { current: false };
