/**
 * The device identity used for ENROLLMENT (docs/DEVICE_ENROLLMENT_DESIGN.md D-I1): the browser PROFILE's stable id (localStorage "device_id", the same key lib/device-id.ts hands to the first tab),
 * so one approval covers every tab of that browser profile. Extra tabs get their own per-tab ids for the WS (lib/device-id.ts) — those are never what gets approved.
 * Clearing site data = a new id = a new request (accepted, and a safety property). Returns null when storage is unavailable (private mode) — such a browser cannot be approved and is simply asked again.
 */
const STABLE_KEY = "device_id";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getEnrollmentDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let v = window.localStorage.getItem(STABLE_KEY)?.trim() ?? "";
    if (!v) {
      v = uuid();
      window.localStorage.setItem(STABLE_KEY, v);
    }
    return v;
  } catch {
    return null;
  }
}

/** the WS-token route's address, carrying this browser's enrollment id (the route ignores it entirely while enrollment is off) */
export function wsTokenUrl(): string {
  const id = getEnrollmentDeviceId();
  return id ? `/api/auth/ws-token?deviceId=${encodeURIComponent(id)}` : "/api/auth/ws-token";
}
