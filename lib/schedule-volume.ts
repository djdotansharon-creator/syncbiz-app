/**
 * A schedule block's VOLUME (owner 2026-11-17: "when I stand on a song I can decide how loud the player is at that time; if it is set and I come to raise it, a window asks whether to break the setting").
 *
 * · The value: `Schedule.volume`, a whole number 0–100, or null / absent = "leave the volume as it is". `normalizeScheduleVolume` is the one place that reads what a request carries.
 * · The engine (components/schedule-auto-player.tsx) applies it when the block starts and tells THIS module which block is in force (`setScheduleVolumeLock`).
 * · A person who RAISES the volume above the block's setting is asked first (`guardVolume`, shown by components/schedule-volume-guard.tsx): "Keep" does nothing, "Change anyway" applies the
 *   change and the block stops asking until the next block takes over. Lowering is never asked — a quieter room breaks nothing.
 * Renderer memory only (never stored, never sent); nothing here touches playback.
 */
import { useSyncExternalStore } from "react";

export { normalizeScheduleVolume } from "@/lib/schedule-volume-value";

export type ScheduleVolumeLock = { blockId: string; name: string; volume: number };

let lock: ScheduleVolumeLock | null = null;
let overriddenBlockId: string | null = null;
let pending: PendingVolume | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version += 1;
  listeners.forEach((l) => l());
};

export type PendingVolume = { value: number; lock: ScheduleVolumeLock; apply: (value: number) => void };

/** the engine: which block (with a volume) is in force now — null when none is, the schedule is off, or it is a quiet block */
export function setScheduleVolumeLock(next: ScheduleVolumeLock | null): void {
  const same = (lock === null && next === null) || (lock !== null && next !== null && lock.blockId === next.blockId && lock.volume === next.volume && lock.name === next.name);
  if (same) return;
  if (next === null || next.blockId !== lock?.blockId) {
    // a different block took over: a question about the old one is void, and the new block asks again
    if (pending) pending = null;
    overriddenBlockId = null;
  }
  lock = next;
  emit();
}

/** is a RAISE to `value` something the block's setting would want to be asked about? */
export function needsVolumeConfirm(value: number, current: ScheduleVolumeLock | null, overridden: string | null): boolean {
  return !!current && overridden !== current.blockId && value > current.volume;
}

/**
 * Every manual volume change goes through here. Returns true when it was applied at once; false when the person is being asked (the window shows `pending`).
 * `apply` is the change itself (the Player's own volume path); it is called now, or after "Change anyway".
 */
export function guardVolume(value: number, apply: (value: number) => void): boolean {
  if (!needsVolumeConfirm(value, lock, overriddenBlockId)) {
    apply(value);
    return true;
  }
  pending = { value, lock: lock!, apply };
  emit();
  return false;
}

/** the window's two answers */
export function answerVolumeQuestion(change: boolean): void {
  const p = pending;
  if (!p) return;
  pending = null;
  if (change) {
    overriddenBlockId = p.lock.blockId; // this block stops asking until the next block takes over
    emit();
    p.apply(p.value);
  } else emit();
}

/**
 * What the engine does with the volume when a block STARTS — pure.
 *  · the block has a volume → set it; the first time (no remembered base) the volume the player had is remembered, so it can come back;
 *  · the block has none and a base is remembered → the volume comes back to it (the setting was "for that time"), and the memory is cleared;
 *  · otherwise nothing.
 */
export function decideVolumeOnStart(input: { blockVolume: number | null; currentVolume: number | null; base: number | null }): { set: number | null; saveBase: number | null; clearBase: boolean } {
  const { blockVolume, currentVolume, base } = input;
  if (blockVolume !== null) return { set: blockVolume, saveBase: base === null && currentVolume !== null ? currentVolume : null, clearBase: false };
  if (base !== null) return { set: base, saveBase: null, clearBase: true };
  return { set: null, saveBase: null, clearBase: false };
}

const BASE_KEY = "syncbiz-schedule-volume-base";
export function readVolumeBase(): number | null {
  try {
    const raw = localStorage.getItem(BASE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
  } catch {
    return null;
  }
}
export function writeVolumeBase(v: number | null): void {
  try {
    if (v === null) localStorage.removeItem(BASE_KEY);
    else localStorage.setItem(BASE_KEY, String(Math.round(v)));
  } catch {
    /* the memory is only a help */
  }
}

/** the engine's one call when a block starts (or the app restarts inside one): sets the block's volume, or brings back the volume the player had before the schedule changed it. Returns what it set (null = nothing). */
export function applyBlockVolume(h: { getVolume?: () => number | null; setVolume?: (value: number) => void }, blockVolume: number | null): number | null {
  if (!h.setVolume) return null;
  const d = decideVolumeOnStart({ blockVolume, currentVolume: h.getVolume?.() ?? null, base: readVolumeBase() });
  if (d.saveBase !== null) writeVolumeBase(d.saveBase);
  if (d.clearBase) writeVolumeBase(null);
  if (d.set === null) return null;
  try {
    h.setVolume(d.set);
    return d.set;
  } catch {
    return null; // a failed change is not retried: the block plays at the volume the player has
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** React: the question the person is being asked (null = none) */
export function usePendingVolumeQuestion(): PendingVolume | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return pending;
}

/** React: the block whose volume is in force now (null = none) */
export function useScheduleVolumeLock(): ScheduleVolumeLock | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return lock;
}

/** tests */
export function __resetScheduleVolumeForTests(): void {
  lock = null;
  overriddenBlockId = null;
  pending = null;
  version = 0;
}
