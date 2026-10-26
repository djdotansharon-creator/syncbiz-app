/**
 * Display screen ("kiosk") — the lock and the owner's settings for it (owner 2026-10-25).
 * The lock is a UI cover over the SAME running app: nothing is mounted or unmounted underneath, so playback, the WebSocket and every provider keep
 * going while the screen is locked, while the password is typed and when it opens.
 *
 * Settings (the owner's password + what staff may do on the locked screen) are edited at Access Control → Display screen and live in this browser's
 * localStorage for now. The password is kept only as a salted SHA-256 hash. NOTE: a password checked in the browser keeps customers and staff out of the
 * controller screen — it is NOT a security boundary (that needs the account / server-side permissions, planned next, which also lets the owner set
 * it from his own computer for the store's screen).
 */
import { useSyncExternalStore } from "react";

const LOCK_KEY = "syncbiz-kiosk-locked";
const SETTINGS_KEY = "syncbiz-kiosk-settings";
const THEME_KEY = "syncbiz-kiosk-theme";
const CHANGE_EVENT = "syncbiz-kiosk-changed";
/** the first password, until the owner chooses one */
export const DEFAULT_KIOSK_PIN = "123";

/** What staff may do on the locked display screen. Everything the owner switches off disappears from the screen. */
export type KioskPermissions = {
  /** previous / next song */
  skip: boolean;
  /** pause / play */
  pause: boolean;
  /** search a song and add it to the queue */
  search: boolean;
  /** move a song in "Up next" up or down */
  reorder: boolean;
  /** the jingles widget */
  jingles: boolean;
  /** the volume slider */
  volume: boolean;
  /** drag the progress bar to move within the song (on by default; the owner can switch it off so staff cannot jump to a minute) */
  seek: boolean;
  /** in a search result's ⋯ menu: "add to playlist" and "schedule" (they change the library; Play now / Play next come with `search`) */
  library: boolean;
  /** the "+ New jingle" button on the display's Jingles page: type a sentence, it is spoken and added as a button (owner 2026-10-26) */
  createJingles: boolean;
  /** the "My playlists" page of the side panel: the business's ready-made playlists, one press to put one on (owner 2026-10-26) */
  playlists: boolean;
  /** the loudest staff can set it, 20–100 % (the slider stops there and shows a mark) */
  volumeMax: number;
};

export const DEFAULT_KIOSK_PERMISSIONS: KioskPermissions = { skip: true, pause: true, search: true, reorder: true, jingles: true, volume: true, seek: true, library: true, playlists: true, createJingles: true, volumeMax: 80 };
export const KIOSK_VOLUME_MIN_CAP = 20;

type Stored = { perms?: Partial<KioskPermissions>; pinHash?: string; pinSalt?: string };

// ───────────────────────────────────────────────── lock ─────────────────────────────────────────────────

export function readKioskLocked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function writeLocked(locked: boolean): void {
  try {
    window.localStorage.setItem(LOCK_KEY, locked ? "1" : "0");
  } catch {
    /* private mode — still works for this session */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Cover the controller with the display screen. */
export function lockKiosk(): void {
  writeLocked(true);
}

// ───────────────────────────────────────────────── look: dark / light ─────────────────────────────────────────────────

/** The look of the display screen on this device: by the SONG (white covers give a white screen — the default), or pinned to light / dark by the sun / moon on the screen. */
export type KioskTheme = "auto" | "light" | "dark";

export function readKioskTheme(): KioskTheme {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setKioskTheme(theme: KioskTheme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — still works for this session */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useKioskTheme(): KioskTheme {
  return useSyncExternalStore(subscribe, readKioskTheme, () => "auto");
}

// ───────────────────────────────────────────────── settings ─────────────────────────────────────────────────

function readRaw(): string {
  try {
    return window.localStorage.getItem(SETTINGS_KEY) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): Stored {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Stored) : {};
  } catch {
    return {};
  }
}

function write(next: Stored): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Staff permissions as the owner set them (everything allowed until he changes it). */
export function getKioskPermissions(): KioskPermissions {
  if (typeof window === "undefined") return DEFAULT_KIOSK_PERMISSIONS;
  const p = parse(readRaw()).perms ?? {};
  const out = { ...DEFAULT_KIOSK_PERMISSIONS };
  (["skip", "pause", "search", "reorder", "jingles", "volume", "seek", "library", "playlists", "createJingles"] as const).forEach((k) => {
    if (typeof p[k] === "boolean") out[k] = p[k] as boolean;
  });
  if (typeof p.volumeMax === "number" && Number.isFinite(p.volumeMax)) out.volumeMax = Math.min(100, Math.max(KIOSK_VOLUME_MIN_CAP, Math.round(p.volumeMax)));
  return out;
}

export function setKioskPermissions(patch: Partial<KioskPermissions>): void {
  const cur = parse(readRaw());
  write({ ...cur, perms: { ...getKioskPermissions(), ...patch } });
}

// ───────────────────────────────────────────────── password ─────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True once the owner has chosen his own password (before that it is the first one, 123). */
export function hasCustomKioskPin(): boolean {
  return !!parse(readRaw()).pinHash;
}

/** Does this password match? (the owner's own, or 123 until he chose one) */
export async function verifyKioskPin(pin: string): Promise<boolean> {
  const p = pin.trim();
  if (!p) return false;
  const s = parse(readRaw());
  if (!s.pinHash || !s.pinSalt) return p === DEFAULT_KIOSK_PIN;
  return (await sha256(s.pinSalt + p)) === s.pinHash;
}

/** The owner's own password — stored salted + hashed. An empty one brings the first password (123) back. */
export async function setKioskPin(pin: string): Promise<void> {
  const p = pin.trim();
  const cur = parse(readRaw());
  if (!p) {
    write({ perms: cur.perms });
    return;
  }
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, "0")).join("");
  write({ ...cur, pinSalt: salt, pinHash: await sha256(salt + p) });
}

/** Opens the controller when the password is right. Resolves to whether it opened. */
export async function tryUnlockKiosk(pin: string): Promise<boolean> {
  if (!(await verifyKioskPin(pin))) return false;
  writeLocked(false);
  return true;
}

// ───────────────────────────────────────────────── hooks ─────────────────────────────────────────────────

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useKioskLocked(): boolean {
  return useSyncExternalStore(subscribe, readKioskLocked, () => false);
}

let permsRaw = "\u0000";
let permsCache: KioskPermissions = DEFAULT_KIOSK_PERMISSIONS;
function permsSnapshot(): KioskPermissions {
  const raw = readRaw();
  if (raw !== permsRaw) {
    permsRaw = raw;
    permsCache = getKioskPermissions();
  }
  return permsCache;
}

export function useKioskPermissions(): KioskPermissions {
  return useSyncExternalStore(subscribe, permsSnapshot, () => DEFAULT_KIOSK_PERMISSIONS);
}
