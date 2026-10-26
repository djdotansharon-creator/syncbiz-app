"use client";

/**
 * Control Room — how big the branch list is drawn (owner 2026-10-20): Large = 2 branches per row, Medium = 3, Small = 5.
 * Remembered per browser (localStorage). A tiny external store so the first client render already knows it (no effect, no flash).
 */
import { useCallback, useSyncExternalStore } from "react";

export type CrDensity = "l" | "m" | "s";
const KEY = "syncbiz:cr-density";
const EVENT = "syncbiz:cr-density-change";
const VALID: readonly CrDensity[] = ["l", "m", "s"];

function read(): CrDensity {
  try {
    const v = window.localStorage.getItem(KEY);
    return VALID.includes(v as CrDensity) ? (v as CrDensity) : "m";
  } catch {
    return "m";
  }
}
function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useCrDensity(): [CrDensity, (d: CrDensity) => void] {
  const density = useSyncExternalStore(subscribe, read, () => "m" as CrDensity);
  const set = useCallback((d: CrDensity) => {
    try { window.localStorage.setItem(KEY, d); } catch { /* private mode — the in-memory event below still updates this tab */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [density, set];
}
