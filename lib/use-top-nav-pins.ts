"use client";

/**
 * Per-user top-bar pinning for the main navigation.
 *
 * Rules:
 * - "library" and "radio" are ALWAYS pinned and cannot be unpinned (user spec).
 * - Every other category can be toggled on/off from the gear-icon popover.
 * - Selection persists in localStorage and is shared across tabs via a
 *   storage-change listener.
 *
 * Default when no preference is stored: the set of categories that were hard-
 * coded in the top bar before this feature shipped — keeps the initial visual
 * identical for returning users so upgrading doesn't hide pills they relied on.
 */

import { useCallback, useEffect, useState } from "react";

export const TOP_NAV_PINS_STORAGE_KEY = "syncbiz:topnav:pins:v1";

/** Keys that can never be removed from the top bar. */
const ALWAYS_PINNED = new Set<string>(["library", "radio"]);

/** Initial pinned set when nothing is persisted yet (preserves legacy UX). */
const DEFAULT_PINS: readonly string[] = ["dashboard", "owner", "schedules", "logs"];

function readStoredPins(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TOP_NAV_PINS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

function writeStoredPins(pins: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOP_NAV_PINS_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    /* quota / private-mode — ignore, in-memory state still works */
  }
}

export type UseTopNavPinsReturn = {
  /** Every pinned key, including the always-pinned ones. */
  pinnedSet: Set<string>;
  isPinned: (key: string) => boolean;
  /** No-op when called with "library" or "radio". */
  togglePin: (key: string) => void;
};

export function useTopNavPins(): UseTopNavPinsReturn {
  // Same initial state on server and on the client's first paint — never read
  // localStorage in the useState initializer (server has no localStorage, so
  // pins would differ and cause hydration mismatches in the nav <Link> list).
  const [userPins, setUserPins] = useState<string[]>([...DEFAULT_PINS]);

  // Hydrate from localStorage after mount and keep cross-tab sync.
  useEffect(() => {
    const stored = readStoredPins();
    if (stored) setUserPins(stored);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TOP_NAV_PINS_STORAGE_KEY) return;
      const next = readStoredPins();
      if (next) setUserPins(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const togglePin = useCallback((key: string) => {
    if (ALWAYS_PINNED.has(key)) return;
    setUserPins((prev) => {
      const next = prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key];
      writeStoredPins(next);
      return next;
    });
  }, []);

  const pinnedSet = new Set<string>([...ALWAYS_PINNED, ...userPins]);

  const isPinned = useCallback(
    (key: string) => pinnedSet.has(key),
    // Re-create when userPins changes so callers get a fresh closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userPins],
  );

  return { pinnedSet, isPinned, togglePin };
}
