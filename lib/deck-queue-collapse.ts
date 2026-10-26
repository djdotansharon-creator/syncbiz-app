"use client";

import { useSyncExternalStore } from "react";

/**
 * Deck queue collapse (2026-10-13, display-only). When collapsed, the queue column shows only
 * the cover squares and the player grows to the library's centre-column line. Persisted per
 * browser; no playback involvement.
 */
const KEY = "syncbiz:deckQueueCollapsed";
const EVENT = "syncbiz:deck-queue-collapse-change";

export function readDeckQueueCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDeckQueueCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* private mode — still works for this session */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useDeckQueueCollapsed(): boolean {
  return useSyncExternalStore(subscribe, readDeckQueueCollapsed, () => false);
}
