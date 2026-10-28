"use client";

/**
 * The Control Room's small "is anything waiting for approval" summary, shared by everything that shows it (the red circle on the Control Room tab, the "New requests" tile in the branch list): ONE
 * request to `/api/control-room/enrollments/pending-count` every minute (every 10 minutes while the feature is off or this person decides nothing; nothing while the tab is hidden), however many
 * components listen, re-asked at once when the window gets focus or when the approvals screen changes something (ENROLLMENT_CHANGED_EVENT). Display-only (owner 2026-10-28).
 */

import { useSyncExternalStore } from "react";

export const ENROLLMENT_CHANGED_EVENT = "vono-enrollment-changed";

export type EnrollmentSummary = {
  /** the first answer has arrived */
  loaded: boolean;
  /** the server has the feature switched on at all (env flag) */
  available: boolean;
  /** this workspace switched it on */
  enabled: boolean;
  /** this person may approve / reject something */
  canDecide: boolean;
  /** the main admin (may switch it on / off) */
  isAdmin: boolean;
  /** open requests this person may decide */
  count: number;
};

const EMPTY: EnrollmentSummary = { loaded: false, available: false, enabled: false, canDecide: false, isAdmin: false, count: 0 };

let state: EnrollmentSummary = EMPTY;
const listeners = new Set<() => void>();
let timer = 0;
let running = false;

function publish(next: EnrollmentSummary): void {
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  for (const l of listeners) l();
}

async function tick(): Promise<void> {
  window.clearTimeout(timer);
  let next = 60_000;
  try {
    if (document.visibilityState !== "hidden") {
      const r = await fetch("/api/control-room/enrollments/pending-count", { cache: "no-store", credentials: "include" });
      if (r.ok) {
        const j = (await r.json()) as Partial<EnrollmentSummary>;
        publish({
          loaded: true,
          available: j.available === true,
          enabled: j.enabled === true,
          canDecide: j.canDecide === true,
          isAdmin: j.isAdmin === true,
          count: typeof j.count === "number" && j.count > 0 ? Math.floor(j.count) : 0,
        });
        if (!j.enabled || !j.canDecide) next = 600_000;
      }
    }
  } catch {
    /* offline — keep the answer we have */
  }
  if (running) timer = window.setTimeout(() => void tick(), next);
}

const again = () => void tick();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!running) {
    running = true;
    window.addEventListener("focus", again);
    window.addEventListener(ENROLLMENT_CHANGED_EVENT, again);
    void tick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      running = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", again);
      window.removeEventListener(ENROLLMENT_CHANGED_EVENT, again);
    }
  };
}

export function useEnrollmentSummary(): EnrollmentSummary {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}
