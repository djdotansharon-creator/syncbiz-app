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
 * ONE scheduler per BRANCH per browser profile (F4, owner 2026-10-24): every open tab mounts this component and the
 * tabs of a branch read the SAME localStorage list, so without an owner N tabs fired a scheduled jingle N times.
 * - Only the tab holding the Web Lock `vono-jingle-scheduler:<branch>` runs the timer; the others wait in the lock
 *   queue and take over (within ms) when that tab closes or reloads.
 * - Only a tab with a branch device socket (`isActive`) competes — a page without one could never deliver.
 * - The branch is the SAME one this tab's device socket registers with (`useStationBranchId`), and the schedule list
 *   is stored per branch (schedule-storage.ts) → a Branch-B schedule is fired only by a Branch-B tab, into Branch B.
 * - No Web Locks (very old browsers only) → previous per-tab behaviour.
 *
 * Delivery: a due occurrence is first CLAIMED into the branch's shared fire state (localStorage), then delivered as
 * soon as a branch MASTER exists — waiting up to MASTER_WAIT_MS after its due time (covers the server's 10 s web
 * reload window and CONTROL promotion). If the scheduler tab dies during that wait, the next scheduler tab continues
 * the SAME pending delivery. It is removed from `pending` in the same task that sends it (never sent twice), and a
 * "once" item is removed from the schedule only when it is actually delivered (or given up after the wait window).
 * A new scheduler tab also claims an occurrence that fell due ≤ MASTER_WAIT_MS ago and was never claimed (hand-over gap).
 *
 * While it owns the scheduler, it:
 * - Reads the persisted jingle schedule from localStorage.
 * - Computes the next firing moment across all items.
 * - Sets a single `setTimeout` for that moment (re-scheduling when the list
 *   changes via the custom `JINGLE_SCHEDULE_EVENT` or the native `storage`
 *   event).
 * - On fire: plays the configured pre-roll bell (if any), then the jingle
 *   URL via the Electron MPV interrupt bridge. Removes "once" items once
 *   delivered; leaves "daily"/"weekly" items in place so the next occurrence is
 *   picked up on the next tick.
 *
 * Intentionally has **no UI**. Returns null.
 */

import { useEffect, useRef } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { useStationBranchId } from "@/lib/station-branch";
import {
  JINGLE_SCHEDULE_EVENT,
  lastFiringMs,
  loadFireState,
  loadJingleSchedule,
  nextFiringMs,
  persistJingleSchedule,
  saveFireState,
  type JingleFireState,
  type PendingJingle,
} from "./schedule-storage";
import type { JingleBellStyle, MockScheduleItem } from "./types";

/** Bell duration fallback if we fire the jingle before the bell API resolves. */
const DEFAULT_BELL_MS = 900;
/** One scheduler owner per branch per browser profile (the tabs of a branch share its localStorage schedule). */
const SCHEDULER_LOCK = "vono-jingle-scheduler:";
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
  // The SAME branch this tab's device socket registers with (lib/remote-control/ws-client.ts) — null until known.
  const branchId = useStationBranchId();
  const isActive = !!devicePlayer?.isActive;

  // IRON RULE: local MPV interrupt ONLY when THIS desktop is the branch MASTER. When CONTROL
  // (e.g. the GOtv streamer is MASTER), a scheduled jingle goes over WS to the master device.
  // Kept in a ref so the setTimeout closure (schedule effect runs once) always uses the latest
  // mode; the ref is updated from an effect (never during render).
  const fireRef = useRef<(url: string) => void>(() => {});
  // True when a fire would reach a player now: the local MPV (desktop MASTER — no cloud WS needed) or a known branch
  // MASTER over THIS tab's connected WS. sendCommandToMaster silently drops the command without masterDeviceId AND
  // when the socket is not OPEN; masterDeviceId alone can be stale while the socket is closing (e.g. the ws-client
  // ERROR path sets status "error" then closes) → a delivery is only attempted while the branch socket is connected.
  const canFireRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    const isMaster = devicePlayer?.deviceMode === "MASTER";
    const isDesktop = typeof window !== "undefined" && "syncbizDesktop" in window;
    fireRef.current = (url: string) => {
      if (isDesktop && isMaster) playInterrupt(url);
      else devicePlayer?.sendCommandToMaster("PLAY_INTERRUPT", { url });
    };
    canFireRef.current = () =>
      (isDesktop && isMaster) || (!!devicePlayer?.masterDeviceId && !!devicePlayer?.isBranchConnected);
  });

  useEffect(() => {
    // Only a tab with a branch device socket can deliver; the branch must be known (desktop bridge ≤ 3 s).
    if (!branchId || !isActive) return;
    const branch = branchId;
    let cancelled = false;
    let releaseLock: (() => void) | null = null;
    const lockAbort = new AbortController();
    const waitTimers = new Set<ReturnType<typeof setTimeout>>();
    const waiting = new Set<string>(); // occurrences this tab is already waiting to deliver
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const singleOwner = !!locks && typeof locks.request === "function";
    // The delivery state is SHARED by the branch's tabs only under the Web Lock (one writer). Without Web Locks every
    // tab is its own scheduler, so it keeps its own state (= the previous per-tab behaviour, no cross-tab races).
    let ownState: JingleFireState = { pending: [], claimed: {} };
    const readState = (): JingleFireState => (singleOwner ? loadFireState(branch) : ownState);
    const writeState = (st: JingleFireState): void => {
      if (singleOwner) saveFireState(branch, st);
      else ownState = st;
    };

    function clearTimer(): void {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function removeOnceItem(itemId: string): void {
      const items = loadJingleSchedule(branch);
      const it = items.find((x) => x.id === itemId);
      if (it && (it.repeat ?? "once") === "once") persistJingleSchedule(branch, items.filter((x) => x.id !== itemId));
    }

    /** Claim every occurrence that is due (≤ MASTER_WAIT_MS ago) and not claimed yet into the shared pending list. */
    function claimDue(): void {
      const now = Date.now();
      const items = loadJingleSchedule(branch);
      const state = readState();
      const ids = new Set(items.map((x) => x.id));
      for (const id of Object.keys(state.claimed)) if (!ids.has(id)) delete state.claimed[id];
      for (const it of items) {
        if (!it.url) continue;
        const due = lastFiringMs(it, now);
        if (due === null || now - due > MASTER_WAIT_MS || state.claimed[it.id] === due) continue;
        state.claimed[it.id] = due;
        state.pending.push({ occ: `${it.id}@${due}`, itemId: it.id, dueAt: due });
      }
      writeState(state);
    }

    /** Send a pending occurrence once: removed from `pending` in the same task that fires it. */
    function deliver(p: PendingJingle): void {
      waiting.delete(p.occ);
      if (cancelled) return;
      const state = readState();
      if (!state.pending.some((x) => x.occ === p.occ)) return; // already delivered / given up
      state.pending = state.pending.filter((x) => x.occ !== p.occ);
      writeState(state);
      const item = loadJingleSchedule(branch).find((x) => x.id === p.itemId);
      if (!item) return; // the operator deleted it meanwhile — honour that
      removeOnceItem(item.id);
      fireItem(item, fireRef.current);
    }

    function giveUp(p: PendingJingle): void {
      waiting.delete(p.occ);
      const state = readState();
      state.pending = state.pending.filter((x) => x.occ !== p.occ);
      writeState(state);
      removeOnceItem(p.itemId);
      console.warn("[SyncBiz] scheduled jingle not delivered — no branch MASTER", { occ: p.occ, waitedMs: MASTER_WAIT_MS });
    }

    /** Deliver every pending occurrence as soon as a MASTER can receive it (deadline = due time + MASTER_WAIT_MS). */
    function deliverPending(): void {
      for (const p of readState().pending) {
        if (waiting.has(p.occ)) continue;
        waiting.add(p.occ);
        const attempt = () => {
          if (cancelled) return;
          if (canFireRef.current()) return deliver(p);
          if (Date.now() >= p.dueAt + MASTER_WAIT_MS) return giveUp(p);
          const t = setTimeout(() => {
            waitTimers.delete(t);
            attempt();
          }, MASTER_POLL_MS);
          waitTimers.add(t);
        };
        attempt();
      }
    }

    function schedule(): void {
      if (cancelled) return;
      clearTimer();
      const items = loadJingleSchedule(branch);
      if (items.length === 0) return;

      const now = Date.now();
      let soonest: number | null = null;
      for (const it of items) {
        const at = nextFiringMs(it, now);
        if (at !== null && (soonest === null || at < soonest)) soonest = at;
      }
      if (soonest === null) return;

      // `setTimeout` caps internally at 2^31-1 ms (~24.8 days); if the next
      // firing is further out, re-poll after a day and recompute.
      const delay = Math.min(soonest - now, 24 * 60 * 60 * 1000);
      timerRef.current = setTimeout(tick, Math.max(0, delay));
    }

    /**
     * Claim what is due, deliver what is pending, then arm the next timer. Run on the timer, on every storage change
     * and when this tab becomes the scheduler: rescheduling alone computes the NEXT occurrence, so a change landing
     * just after a due time (another tab's write at that same moment) would otherwise skip it until tomorrow.
     */
    function tick(): void {
      if (cancelled) return;
      claimDue();
      deliverPending();
      schedule();
    }

    const onChange = () => tick();
    function start(): void {
      if (cancelled) return;
      tick(); // also: an occurrence that fell due during the hand-over gap, a delivery the previous scheduler awaited
      window.addEventListener(JINGLE_SCHEDULE_EVENT, onChange);
      window.addEventListener("storage", onChange);
    }

    if (singleOwner) {
      // Held until this tab closes / reloads (or unmounts) — then the next waiting tab becomes the scheduler.
      locks!
        .request(SCHEDULER_LOCK + branch, { signal: lockAbort.signal }, () => {
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
  }, [branchId, isActive]);

  return null;
}
