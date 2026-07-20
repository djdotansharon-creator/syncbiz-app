"use client";

import { useSyncExternalStore } from "react";

/**
 * Desktop player background mode — a PER-DEVICE preference (different PCs have
 * different capabilities), persisted in localStorage. Deliberately NOT tied to
 * MASTER/CONTROL or any server state.
 *
 * - "artwork" (default): the song's cover as a crisp still (a paused-video look),
 *   no second media stream. The recommended, lowest-load option.
 * - "video": the muted YouTube clip (existing DesktopVideoDock), capped low and
 *   shown only once MPV is actually progressing; falls back to artwork on any
 *   trouble. Heavier — a second video stream alongside MPV audio.
 *
 * Every NEW install defaults to "artwork" (no stored value → artwork).
 */
export type DesktopBackgroundMode = "artwork" | "video";

const STORAGE_KEY = "syncbiz:desktopBgMode";
const CHANGE_EVENT = "syncbiz:desktopBgMode:changed";
const DEFAULT_MODE: DesktopBackgroundMode = "artwork";

function isMode(v: unknown): v is DesktopBackgroundMode {
  return v === "artwork" || v === "video";
}

export function getDesktopBackgroundMode(): DesktopBackgroundMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isMode(v) ? v : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function setDesktopBackgroundMode(mode: DesktopBackgroundMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* storage unavailable — non-fatal, the UI just won't persist */
  }
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb); // sync across tabs/windows
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Reactive hook — re-renders when the per-device background mode changes. */
export function useDesktopBackgroundMode(): DesktopBackgroundMode {
  return useSyncExternalStore(subscribe, getDesktopBackgroundMode, () => DEFAULT_MODE);
}
