"use client";

/**
 * Root-level background runtime that fires scheduled jingles.
 *
 * Mirrors the pattern of `ScheduleAutoPlayer` (for regular schedule blocks)
 * but reads jingle schedules from localStorage — no DB round-trip — because
 * jingles are a per-station, operator-local concern in the current phase.
 *
 * Mount it once, near the top of the client tree (e.g. in `AppProviders`).
 *
 * ONE scheduler per browser profile (F4, owner 2026-10-24): every open tab mounts this component and all tabs read
 * the SAME localStorage list, so without an owner N tabs fired a scheduled jingle N times. Only the tab holding the
 * Web Lock `vono-jingle-scheduler` runs the timer; the others wait in the lock queue and take over (within ms) when
 * that tab closes or reloads. No Web Locks (very old browsers only) → previous per-tab behaviour.
 *
 * At fire time the jingle waits (up to MASTER_WAIT_MS) for a branch MASTER to exist, so a scheduled jingle due exactly
 * while the MASTER reloads / closes / is being promoted is delivered once when it is back — instead of being dropped.
 *
 * While it owns the scheduler, it:
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
import { useDevicePlayer } from "@/lib/device-player-context";
import {
  JINGLE_SCHEDULE_EVENT,
  loadJingleSchedule,
  nextFiringMs,
  persistJingleSchedule,
} from "./schedule-storage";
import type { JingleBellStyle, MockScheduleItem } from "./types";

/** Bell duration fallback if we fire the jingle before the bell API resolves. */
const DEFAULT_BELL_MS = 900;
/** One scheduler owner per browser profile (all tabs share the localStorage schedule). */
const SCHEDULER_LOCK = "vono-jingle-scheduler";
/** Covers the server's 10 s web-MASTER reload window + CONTROL promotion. */
const MASTER_WAIT_MS = 15_000;
const MASTER_POLL_MS = 500;

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
function fireItem(item: MockScheduleItem, fire: (url: string) => void): void {
  if (!item.url) return;
  const bell = item.preRoll ? bellUrl(item.bellStyle) : null;
  if (bell) {
    fire(bell);
    window.setTimeout(() => fire(item.url!), DEFAULT_BELL_MS);
  } else {
    fire(item.url);
  }
}

export function JingleScheduleAutoPlayer(): null {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const devicePlayer = useDevicePlayer();

  // IRON RULE: local MPV interrupt ONLY when THIS desktop is the branch MASTER. When CONTROL
  // (e.g. the GOtv streamer is MASTER), a scheduled jingle goes over WS to the master device.
  // Kept in a ref so the setTimeout closure (schedule effect runs once) always uses the latest
  // mode; the ref is updated from an effect (never during render).
  const fireRef = useRef<(url: string) => void>(() => {});
  // True when a fire would reach a player now: the local MPV (desktop MASTER) or a known branch MASTER over WS
  // (sendCommandToMaster silently drops the command without masterDeviceId).
  const canFireRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    const isMaster = devicePlayer?.deviceMode === "MASTER";
    const isDesktop = typeof window !== "undefined" && "syncbizDesktop" in window;
    fireRef.current = (url: string) => {
      if (isDesktop && isMaster) playInterrupt(url);
      else devicePlayer?.sendCommandToMaster("PLAY_INTERRUPT", { url });
    };
    canFireRef.current = () => (isDesktop && isMaster) || !!devicePlayer?.masterDeviceId;
  });

  useEffect(() => {
    let cancelled = false;
    let releaseLock: (() => void) | null = null;
    const lockAbort = new AbortController();
    const waitTimers = new Set<ReturnType<typeof setTimeout>>();

    function clearTimer(): void {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    /** Run `fire` as soon as a MASTER can receive it; give up (log) after MASTER_WAIT_MS. */
    function whenMasterReady(label: string, fire: () => void): void {
      const deadline = Date.now() + MASTER_WAIT_MS;
      const attempt = () => {
        if (cancelled) return;
        if (canFireRef.current()) return fire();
        if (Date.now() >= deadline) {
          console.warn("[SyncBiz] scheduled jingle not delivered — no branch MASTER", { label, waitedMs: MASTER_WAIT_MS });
          return;
        }
        const t = setTimeout(() => {
          waitTimers.delete(t);
          attempt();
        }, MASTER_POLL_MS);
        waitTimers.add(t);
      };
      attempt();
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
          whenMasterReady(target.label, () => fireItem(target, fireRef.current));
          if ((target.repeat ?? "once") === "once") {
            persistJingleSchedule(fresh.filter((x) => x.id !== target.id));
          }
        }
        schedule();
      }, Math.max(0, delay));
    }

    const onChange = () => schedule();
    function start(): void {
      if (cancelled) return;
      schedule();
      window.addEventListener(JINGLE_SCHEDULE_EVENT, onChange);
      window.addEventListener("storage", onChange);
    }

    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks && typeof locks.request === "function") {
      // Held until this tab closes / reloads (or unmounts) — then the next waiting tab becomes the scheduler.
      locks
        .request(SCHEDULER_LOCK, { signal: lockAbort.signal }, () => {
          if (cancelled) return undefined;
          start();
          return new Promise<void>((resolve) => (releaseLock = resolve));
        })
        .catch(() => {
          /* aborted on unmount */
        });
    } else {
      console.warn("[SyncBiz] Web Locks unavailable — jingle scheduler runs in this tab without a single owner");
      start();
    }

    return () => {
      cancelled = true;
      clearTimer();
      for (const t of waitTimers) clearTimeout(t);
      waitTimers.clear();
      window.removeEventListener(JINGLE_SCHEDULE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
      lockAbort.abort();
      releaseLock?.();
    };
  }, []);

  return null;
}
