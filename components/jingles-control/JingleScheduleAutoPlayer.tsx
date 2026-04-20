"use client";

/**
 * Root-level background runtime that fires scheduled jingles.
 *
 * Mirrors the pattern of `ScheduleAutoPlayer` (for regular schedule blocks)
 * but reads jingle schedules from localStorage — no DB round-trip — because
 * jingles are a per-station, operator-local concern in the current phase.
 *
 * Mount it once, near the top of the client tree (e.g. in `AppProviders`).
 * While mounted, it:
 * - Reads the persisted jingle schedule from localStorage.
 * - Computes the next firing moment across all items.
 * - Sets a single `setTimeout` for that moment (re-scheduling when the list
 *   changes via the custom `JINGLE_SCHEDULE_EVENT` or the native `storage`
 *   event).
 * - On fire: plays the configured pre-roll bell (if any), then the jingle
 *   URL via the Electron MPV interrupt bridge. Removes "once" items once
 *   fired; leaves "daily"/"weekly" items in place so the next occurrence is
 *   picked up on the next tick.
 *
 * Intentionally has **no UI**. Returns null.
 */

import { useEffect, useRef } from "react";
import {
  JINGLE_SCHEDULE_EVENT,
  loadJingleSchedule,
  nextFiringMs,
  persistJingleSchedule,
} from "./schedule-storage";
import type { JingleBellStyle, MockScheduleItem } from "./types";

/** Bell duration fallback if we fire the jingle before the bell API resolves. */
const DEFAULT_BELL_MS = 900;

function bellUrl(style: JingleBellStyle | undefined): string | null {
  if (!style || style === "off") return null;
  return `/api/jingles/bell/${style}`;
}

function toAbsolute(url: string): string {
  if (typeof window === "undefined") return url;
  return url.startsWith("/") ? `${window.location.origin}${url}` : url;
}

function playInterrupt(url: string): void {
  if (typeof window === "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as unknown as { syncbizDesktop?: any }).syncbizDesktop;
  if (api?.mpvPlayInterrupt) {
    try {
      api.mpvPlayInterrupt(toAbsolute(url));
    } catch {
      /* swallow — next poll will retry */
    }
  }
}

/**
 * Fires a single scheduled item: pre-roll bell (if configured) followed by the
 * jingle URL. The bell is extremely short (<1 s) and MPV's interrupt channel
 * queues itself, so a small delay is sufficient.
 */
function fireItem(item: MockScheduleItem): void {
  if (!item.url) return;
  const bell = item.preRoll ? bellUrl(item.bellStyle) : null;
  if (bell) {
    playInterrupt(bell);
    window.setTimeout(() => playInterrupt(item.url!), DEFAULT_BELL_MS);
  } else {
    playInterrupt(item.url);
  }
}

export function JingleScheduleAutoPlayer(): null {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function clearTimer(): void {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function schedule(): void {
      if (cancelled) return;
      clearTimer();
      const items = loadJingleSchedule();
      if (items.length === 0) return;

      const now = Date.now();
      let soonest: { at: number; item: MockScheduleItem } | null = null;
      for (const it of items) {
        const at = nextFiringMs(it, now);
        if (at === null) continue;
        if (!soonest || at < soonest.at) soonest = { at, item: it };
      }
      if (!soonest) return;

      // `setTimeout` caps internally at 2^31-1 ms (~24.8 days); if the next
      // firing is further out, re-poll after a day and recompute.
      const delay = Math.min(soonest.at - now, 24 * 60 * 60 * 1000);
      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        const fresh = loadJingleSchedule();
        const target = fresh.find((x) => x.id === soonest!.item.id);
        if (target) {
          fireItem(target);
          if ((target.repeat ?? "once") === "once") {
            persistJingleSchedule(fresh.filter((x) => x.id !== target.id));
          }
        }
        schedule();
      }, Math.max(0, delay));
    }

    schedule();

    const onChange = () => schedule();
    window.addEventListener(JINGLE_SCHEDULE_EVENT, onChange);
    window.addEventListener("storage", onChange);

    return () => {
      cancelled = true;
      clearTimer();
      window.removeEventListener(JINGLE_SCHEDULE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return null;
}
