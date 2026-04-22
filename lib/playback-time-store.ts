"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny subscribable store that mirrors the currently-playing engine's position
 * and duration so surfaces outside of `AudioPlayer` (mobile mini-player, Now
 * Playing sheet, etc.) can read them without plumbing through
 * `PlaybackProvider` or forcing `DevicePlayerContext` to re-render on every
 * tick.
 *
 * Why a singleton instead of context:
 *   - `AudioPlayer` already tracks position/duration internally (state +
 *     `lastUi*Ref`). A context that re-renders on every position update would
 *     thrash the entire mobile subtree 2–5× per second.
 *   - Consumers here only need a low-frequency sampled view (e.g. once per
 *     ~500 ms) — the subscriber below polls its own React state on that
 *     cadence.
 *   - Controller-mode surfaces read `station.remoteState.position/duration`
 *     directly and do NOT use this store; this store is the *local player*
 *     mirror only.
 */

type Snapshot = { position: number; duration: number };

let current: Snapshot = { position: 0, duration: 0 };
// Stable server-side snapshot reference to satisfy useSyncExternalStore.
const SERVER_SNAPSHOT: Snapshot = { position: 0, duration: 0 };
const listeners = new Set<() => void>();

function emit() {
  // Reference change lets useSyncExternalStore detect an update.
  current = { position: current.position, duration: current.duration };
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* swallow — one bad subscriber must not break the rest */
    }
  }
}

export function setLocalPlaybackPosition(next: number): void {
  if (!Number.isFinite(next)) return;
  if (Math.abs(next - current.position) < 0.25) return;
  current = { position: next, duration: current.duration };
  emit();
}

export function setLocalPlaybackDuration(next: number): void {
  if (!Number.isFinite(next)) return;
  if (Math.abs(next - current.duration) < 0.25) return;
  current = { position: current.position, duration: next };
  emit();
}

/** Reset on source change / stop. */
export function resetLocalPlaybackTime(): void {
  current = { position: 0, duration: 0 };
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): Snapshot {
  return current;
}

function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

/**
 * Subscribe to local playback time. React updates fire only when the store
 * emits (which itself only emits when the underlying value meaningfully
 * changed — see `setLocal*` above).
 */
export function useLocalPlaybackTime(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
