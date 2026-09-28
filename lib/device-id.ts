/**
 * Device ID system for remote player control.
 * Each computer running the player gets a unique device_id stored in localStorage.
 */

const STORAGE_KEY = "device_id";

/** Generate a UUID v4 using crypto.randomUUID or fallback */
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Cached device_id - avoids re-reading localStorage on every getDeviceId() call */
let cachedDeviceId: string | null = null;

/**
 * Initialize device_id on startup. Runs once.
 * If no device_id exists in localStorage, generates a new UUID and saves it.
 * If it exists, reuses it.
 * @returns The device_id (existing or newly created)
 */
export function initDeviceId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  if (cachedDeviceId) {
    return cachedDeviceId;
  }
  // DESKTOP (Phase 0.1): the durable MACHINE identity lives in ProgramData and is injected synchronously by
  // the Electron preload as `syncbizDesktop.durableDeviceId`. It is authoritative — prefer it over
  // localStorage and MIRROR it into localStorage, so WS registration + this id survive a localStorage clear
  // and match the MAIN WS/heartbeat id. In a plain browser, `syncbizDesktop` is undefined → fall through to
  // the existing localStorage behavior unchanged.
  try {
    const durable = (window as unknown as { syncbizDesktop?: { durableDeviceId?: unknown } }).syncbizDesktop
      ?.durableDeviceId;
    if (typeof durable === "string" && durable.trim().length >= 8) {
      const id = durable.trim();
      cachedDeviceId = id;
      try {
        if (localStorage.getItem(STORAGE_KEY) !== id) localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* mirror is best-effort; MAIN remains authoritative */
      }
      console.log("[SyncBiz] device_id (durable machine id):", id);
      return id;
    }
  } catch {
    /* no desktop bridge → browser path below */
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim().length > 0) {
      cachedDeviceId = stored;
      console.log("[SyncBiz] device_id (reused):", cachedDeviceId);
      return cachedDeviceId;
    }
    const newId = generateUUID();
    localStorage.setItem(STORAGE_KEY, newId);
    cachedDeviceId = newId;
    console.log("[SyncBiz] device_id (new):", cachedDeviceId);
    return cachedDeviceId;
  } catch {
    const fallback = generateUUID();
    cachedDeviceId = fallback;
    console.warn("[SyncBiz] localStorage unavailable, using ephemeral device_id:", fallback);
    return fallback;
  }
}

/**
 * Returns the stored device_id. Calls initDeviceId() if not yet initialized.
 */
export function getDeviceId(): string {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }
  return initDeviceId();
}
