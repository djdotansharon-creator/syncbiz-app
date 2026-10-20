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

/**
 * Reactive notification for `localSourceExecAllowed` transitions. The one-shot playback restore subscribes so it
 * can wait DETERMINISTICALLY (no timeout/sleep) for the designated-station permission to resolve on cold boot —
 * e.g. an offline station whose `designatedStationOffline` only becomes known once the MAIN snapshot arrives.
 */
/**
 * True once the local-exec permission is RESOLVED (the MAIN sent at least one status snapshot, or there is no
 * Electron bridge). Lets the one-shot restore stop waiting for a device that is legitimately NOT permitted
 * (e.g. a non-designated Dev-PC) instead of hanging. Set by DevicePlayerProvider after the first snapshot.
 */
export const localExecResolved = { current: false };

/**
 * P0 Gate 2d: the co-located MAIN's restart-restore decision (snapshot `bootSource`). "deciding" → the one-shot
 * restore waits; "url" → MAIN restores the station's saved URL source (the renderer must NOT start LOCAL);
 * "url-pending" → offline boot (or the restored URL failed): the LOCAL fallback plays until MAIN brings the URL back;
 * "url-failed" → the remembered URL could not be restored: LOCAL plays on; anything else → the normal
 * restore. null = no MAIN value (browser / older desktop) → unchanged behavior. Notified via the same listeners.
 */
export const mainBootSource: { current: string | null } = { current: null };

const localExecListeners = new Set<() => void>();
export function subscribeLocalSourceExec(cb: () => void): () => void {
  localExecListeners.add(cb);
  return () => { localExecListeners.delete(cb); };
}
export function notifyLocalSourceExecChanged(): void {
  for (const cb of [...localExecListeners]) {
    try { cb(); } catch { /* a listener must never break the notifier */ }
  }
}
