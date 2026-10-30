"use client";

/**
 * "Is anyone waiting to join my business?" — ONE request to /api/join/pending-count however many components listen: every 15 seconds for a person who decides join requests, every minute for anyone else
 * (every 10 minutes while the feature is off), nothing while the tab is hidden — and every 4 seconds while a join code is on show (the server says `live`) and for 20 seconds after, so a new person's
 * card can pop up almost as he sends his request (owner 2026-10-31). Asked again at once when the window gets focus or when the People panel changes something (JOIN_CHANGED_EVENT). The red circle is display-only
 * (owner 2026-10-30: "a red circle for people who ask to join").
 */

import { useSyncExternalStore } from "react";

export const JOIN_CHANGED_EVENT = "vono-join-changed";

export type JoinPending = { loaded: boolean; enabled: boolean; count: number };
const EMPTY: JoinPending = { loaded: false, enabled: false, count: 0 };
const LIVE_MS = 4_000;
/** an approver's screen asks this often (the card pops up within about this long on a device that is NOT showing the code) */
const APPROVER_MS = 15_000;
const LIVE_TAIL_MS = 20_000;
let liveUntil = 0;

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
        const j = (await r.json()) as Partial<JoinPending> & { live?: boolean };
        publish({ loaded: true, enabled: Boolean(j.enabled), count: Math.max(0, Number(j.count) || 0) });
        if (j.live) liveUntil = Date.now() + LIVE_TAIL_MS;
        if (!j.enabled || !(Number(j.count) >= 0)) next = 600_000;
        else if (Date.now() < liveUntil) next = LIVE_MS;
        else if (typeof j.live === "boolean") next = APPROVER_MS; // only a person who decides requests is told `live` at all
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
