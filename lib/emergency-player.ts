/**
 * The deliberate "use this browser as the Player (emergency)" choice (owner 2026-10-31 / 2026-11-02): a plain browser is a REMOTE by default, from the very
 * first paint; only this one-time choice (remembered until the browser connects) makes it act as a Player while it is still connecting.
 * Kept in localStorage and announced with a window event so the device context (lib/device-player-context.tsx) and the connect veil agree at once.
 */

export const EMERGENCY_PLAYER_KEY = "vono_emergency_player";
const EVENT = "vono-emergency-player-change";

export function readEmergencyPlayer(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(EMERGENCY_PLAYER_KEY) === "1"; } catch { return false; }
}

function announce(): void {
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* ignore */ }
}

export function setEmergencyPlayer(): void {
  try { window.localStorage.setItem(EMERGENCY_PLAYER_KEY, "1"); } catch { /* the choice still holds for this page through the event */ }
  announce();
}

export function clearEmergencyPlayer(): void {
  try { window.localStorage.removeItem(EMERGENCY_PLAYER_KEY); } catch { /* ignore */ }
  announce();
}

/** useSyncExternalStore subscription: fires when the choice is made / forgotten (this tab) or changed in another tab. */
export function subscribeEmergencyPlayer(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}
