/**
 * Mix/crossfade preferences. Persisted locally.
 */

const STORAGE_KEY_MIX = "syncbiz-mix-duration";
const STORAGE_KEY_AUTOMIX = "syncbiz-automix";
const STORAGE_KEY_SHUFFLE = "syncbiz-shuffle";

export const MIX_DURATIONS = [3, 6, 9, 12] as const;
export type MixDuration = (typeof MIX_DURATIONS)[number];

const DEFAULT_MIX_DURATION: MixDuration = 6;

export function getMixDuration(): MixDuration {
  if (typeof window === "undefined") return DEFAULT_MIX_DURATION;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MIX);
    if (!raw) return DEFAULT_MIX_DURATION;
    const n = parseInt(raw, 10);
    if (MIX_DURATIONS.includes(n as MixDuration)) return n as MixDuration;
  } catch {
    /* ignore */
  }
  return DEFAULT_MIX_DURATION;
}

const MIX_DURATION_CHANGED = "syncbiz-mix-duration-changed";
const AUTOMIX_CHANGED = "syncbiz-automix-changed";

export function setMixDuration(seconds: MixDuration): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_MIX, String(seconds));
    window.dispatchEvent(new CustomEvent(MIX_DURATION_CHANGED, { detail: seconds }));
  } catch {
    /* ignore */
  }
}

/** Subscribe to mix duration changes (e.g. from Settings). */
export function onMixDurationChanged(cb: (seconds: MixDuration) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<MixDuration>).detail);
  window.addEventListener(MIX_DURATION_CHANGED, handler);
  return () => window.removeEventListener(MIX_DURATION_CHANGED, handler);
}

/** AutoMix on/off. Client-only read to avoid SSR/hydration mismatch. */
export function getAutoMix(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUTOMIX);
    if (raw === null) return false;
    return raw === "1" || raw.toLowerCase() === "true";
  } catch {
    return false;
  }
}

export function setAutoMix(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_AUTOMIX, value ? "1" : "0");
    window.dispatchEvent(new CustomEvent(AUTOMIX_CHANGED, { detail: value }));
  } catch {
    /* ignore */
  }
}

/** Subscribe to AutoMix preference changes (localStorage-driven). */
export function onAutoMixChanged(cb: (value: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<boolean>).detail);
  window.addEventListener(AUTOMIX_CHANGED, handler);
  return () => window.removeEventListener(AUTOMIX_CHANGED, handler);
}

/** Shuffle/Random on/off. Client-only read to avoid SSR/hydration mismatch. */
export function getShuffle(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SHUFFLE);
    if (raw === null) return false;
    return raw === "1" || raw.toLowerCase() === "true";
  } catch {
    return false;
  }
}

export function setShufflePreference(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_SHUFFLE, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}
