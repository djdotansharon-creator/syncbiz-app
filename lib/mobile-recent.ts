"use client";

import { useMemo, useSyncExternalStore } from "react";
import { parseRecent, pushRecent, recentKey } from "@/lib/mobile-home";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * What was sent to a branch FROM THIS PHONE lately — the Home screen's "Played lately" shelf (owner 2026-11-20).
 * Only ids are kept, on this phone only (localStorage) — nothing is sent anywhere and no path or URL is stored. A phone that blocks storage simply has no shelf.
 */
const KEY = "vono-mobile-recent-v1";
const EVENT = "vono-mobile-recent";

export function recordRecent(s: Pick<UnifiedSource, "origin" | "id">): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(pushRecent(parseRecent(window.localStorage.getItem(KEY)), recentKey(s))));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage blocked: no shelf, nothing else changes */
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
const snapshot = (): string => {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

/** the remembered keys, newest first (empty on the server and until the phone has said — no flash, no hydration difference) */
export function useRecentKeys(): string[] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  return useMemo(() => parseRecent(raw), [raw]);
}
