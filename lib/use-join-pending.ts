"use client";

/**
 * "Is anyone waiting to join my business?" — ONE request to /api/join/pending-count every minute (every 10 minutes while the feature is off or this person decides nothing; nothing while the tab is
 * hidden), however many components listen; asked again at once when the window gets focus or when the People-joining panel changes something (JOIN_CHANGED_EVENT). Display-only (owner 2026-10-30:
 * "a red circle for people who ask to join").
 */

import { useSyncExternalStore } from "react";

export const JOIN_CHANGED_EVENT = "vono-join-changed";

export type JoinPending = { loaded: boolean; enabled: boolean; count: number };
const EMPTY: JoinPending = { loaded: false, enabled: false, count: 0 };

let state: JoinPending = EMPTY;
const listeners = new Set<() => void>();
let timer = 0;
let running = false;

function publish(next: JoinPending): void {
  if (next.loaded === state.loaded && next.enabled === state.enabled && next.count === state.count) return;
  state = next;
  for (const l of listeners) l();
}

async function tick(): Promise<void> {
  window.clearTimeout(timer);
  let next = 60_000;
  try {
    if (document.visibilityState !== "hidden") {
      const r = await fetch("/api/join/pending-count", { cache: "no-store", credentials: "include" });
      if (r.ok) {
        const j = (await r.json()) as Partial<JoinPending>;
        publish({ loaded: true, enabled: Boolean(j.enabled), count: Math.max(0, Number(j.count) || 0) });
        if (!j.enabled || !(Number(j.count) >= 0)) next = 600_000;
      }
    }
  } catch {
    /* offline — keep what is shown */
  }
  if (running) timer = window.setTimeout(() => void tick(), next);
}

const onWake = (): void => void tick();

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!running) {
    running = true;
    window.addEventListener("focus", onWake);
    window.addEventListener(JOIN_CHANGED_EVENT, onWake);
    void tick();
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      running = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onWake);
      window.removeEventListener(JOIN_CHANGED_EVENT, onWake);
    }
  };
}

export function useJoinPending(): JoinPending {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}
