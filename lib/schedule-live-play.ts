/**
 * "A schedule is playing - play this anyway?" (owner 2026-11-25: "if the schedule is running now and I push a song live, I want a notice: a schedule is active, play anyway? yes or no").
 *
 * · The engine (components/schedule-auto-player.tsx) tells THIS module which block is playing music now (`setLiveBlock`) - the same block it already uses for the block's volume.
 * · A song / playlist a PERSON starts by hand (a library card, a drop on the player, a search result) goes through `guardLivePlay(apply)`: with no block in force, or after the person already said
 *   "play" for this block, `apply()` runs at once, exactly as before; otherwise the window asks (components/schedule-live-play-guard.tsx) and `apply` runs only after "Play anyway". "No" changes NOTHING - `apply`
 *   is the WHOLE action (the queue change and the play), so a "no" leaves the queue and the music exactly as they were.
 * · "Play anyway" is remembered for that block only - the person is not asked again until the next block takes over.
 * Not asked: NEXT / PREVIOUS / seek / pause / volume, anything the engine itself starts, the phone.
 * Renderer memory only (never stored, never sent); nothing here touches playback.
 */
import { useSyncExternalStore } from "react";

export type LiveBlock = { blockId: string; name: string; endTime: string | null };

let live: LiveBlock | null = null;
let overriddenBlockId: string | null = null;
let pending: PendingLivePlay | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version += 1;
  listeners.forEach((l) => l());
};

export type PendingLivePlay = { block: LiveBlock; apply: () => void };

/** the engine: which block is playing music now - null when none is, the schedule is off, or it is a quiet block */
export function setLiveBlock(next: LiveBlock | null): void {
  const same = (live === null && next === null) || (live !== null && next !== null && live.blockId === next.blockId && live.name === next.name && live.endTime === next.endTime);
  if (same) return;
  if (next === null || next.blockId !== live?.blockId) {
    // a different block took over: a question about the old one is void, and the new block asks again
    if (pending) pending = null;
    overriddenBlockId = null;
  }
  live = next;
  emit();
}

/** is a manual play something the block in force wants to be asked about? */
export function needsLivePlayConfirm(current: LiveBlock | null, overridden: string | null): boolean {
  return !!current && overridden !== current.blockId;
}

/** would a manual play ask right now? (a pure look - it changes nothing) */
export function livePlayWouldAsk(): boolean {
  return needsLivePlayConfirm(live, overriddenBlockId);
}

/**
 * Every manual "play this now" goes through here. Returns true when `apply` ran at once; false when the person is being asked (the window shows `pending`).
 * `apply` is the WHOLE action (queue change + play); it runs now, or after "Play anyway", or never.
 */
export function guardLivePlay(apply: () => void): boolean {
  if (!needsLivePlayConfirm(live, overriddenBlockId)) {
    apply();
    return true;
  }
  pending = { block: live!, apply }; // a newer question replaces an older one that was never answered
  emit();
  return false;
}

/** the window's two answers */
export function answerLivePlayQuestion(play: boolean): void {
  const p = pending;
  if (!p) return;
  pending = null;
  if (play) {
    overriddenBlockId = p.block.blockId; // this block stops asking until the next block takes over
    emit();
    p.apply();
  } else emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** React: the question the person is being asked (null = none) */
export function usePendingLivePlay(): PendingLivePlay | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return pending;
}

/** tests */
export function __resetLivePlayForTests(): void {
  live = null;
  overriddenBlockId = null;
  pending = null;
  version = 0;
}
