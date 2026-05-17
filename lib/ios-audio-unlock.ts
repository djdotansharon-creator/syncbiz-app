"use client";

import { useEffect, useState } from "react";

/**
 * iOS Safari requires `audio.play()` to be called *synchronously* inside a
 * user-gesture event handler for the very first activation of an `<audio>`
 * element. After a successful gesture-driven play, subsequent programmatic
 * `play()` calls work — until the gesture activation expires (long
 * backgrounding / screen lock).
 *
 * SyncBiz's mobile PLAYER mode hits this rule because the actual `audio.play()`
 * call lives in `AudioPlayer`'s `useEffect`, which runs after the React
 * commit that follows the user's tap — outside the gesture window. This
 * module bridges that gap.
 *
 * Responsibilities:
 *   1. Detect iOS UA.
 *   2. Hold the live `<audio>` element ref registered by `AudioPlayer`.
 *   3. `primeIOSFromGesture()` — called synchronously inside a tap handler
 *      so iOS counts the gesture for that element.
 *   4. A "needs Tap to resume" flag surfaced as `useIOSNeedsTapToResume()`
 *      so the mobile UI can render an explicit affordance after iOS rejects
 *      a programmatic `play()` post-background instead of pretending audio
 *      is running.
 *
 * Non-iOS callers short-circuit. Desktop / Electron / Android paths are
 * never affected.
 */

// 0.05s silent MP3, used as a safe placeholder src when iOS gesture priming
// has to call play() before any real source is bound to the audio element.
// The real track URL replaces this on the next React commit via the existing
// AudioPlayer src-binding effect; the placeholder is paused immediately on
// resolution so it makes no sound.
const SILENT_MP3 =
  "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAABJbmZvAAAADwAAAAEAAAEoAB8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fH/////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAQHAAAAAAAAASibKaA1AAAAAAAAAAAAAAAAAAAAAA==";

let audioElement: HTMLAudioElement | null = null;
let primedOnce = false;
let needsTapToResume = false;
const subscribers = new Set<() => void>();

function emit(): void {
  subscribers.forEach((s) => {
    try {
      s();
    } catch {
      /* ignore */
    }
  });
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Registered by `AudioPlayer` once its `<audio>` element mounts. */
export function registerIOSAudioElement(el: HTMLAudioElement | null): void {
  audioElement = el;
  if (!el) primedOnce = false;
}

/**
 * Synchronous: must run inside a user-gesture handler. Calls `audio.play()`
 * on the registered element so iOS records gesture activation. If no real
 * src is bound yet, a silent placeholder is set so play() can actually
 * start; AudioPlayer's existing src-binding effect overwrites it on the
 * next commit, which is what the user actually hears.
 *
 * Caller does NOT await — playback status is owned by AudioPlayer's
 * existing useEffects. This call only satisfies iOS's gesture rule.
 */
export function primeIOSFromGesture(): void {
  if (!isIOS()) return;
  const audio = audioElement;
  if (!audio) return;

  const usedPlaceholder = !audio.src;
  if (usedPlaceholder) {
    try {
      audio.src = SILENT_MP3;
    } catch {
      return;
    }
  }
  try {
    const p = audio.play();
    primedOnce = true;
    if (p && typeof p.then === "function") {
      p.then(() => {
        if (usedPlaceholder && audioElement && audioElement.src === SILENT_MP3) {
          try {
            audioElement.pause();
            audioElement.removeAttribute("src");
            audioElement.load();
          } catch {
            /* ignore */
          }
        }
      }).catch(() => {
        if (usedPlaceholder && audioElement && audioElement.src === SILENT_MP3) {
          try {
            audioElement.removeAttribute("src");
            audioElement.load();
          } catch {
            /* ignore */
          }
        }
      });
    }
  } catch {
    /* ignore — caller's playback flow continues; UI will show paused state */
  }
}

export function hasPrimedIOS(): boolean {
  return primedOnce;
}

export function setIOSNeedsTapToResume(v: boolean): void {
  if (needsTapToResume === v) return;
  needsTapToResume = v;
  emit();
}

export function getIOSNeedsTapToResume(): boolean {
  return needsTapToResume;
}

/**
 * Returns `true` iff a play() rejection is iOS Safari's autoplay block,
 * which is the case the mobile UI must surface as "Tap to resume". Other
 * rejections (load errors, network) flow through the existing error path.
 */
export function isIOSAutoplayBlock(err: unknown): boolean {
  if (!isIOS()) return false;
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "NotAllowedError";
}

/** Hook for mobile UI components that render the "Tap to resume" affordance. */
export function useIOSNeedsTapToResume(): boolean {
  const [v, setV] = useState<boolean>(() => needsTapToResume);
  useEffect(() => {
    const fn = () => setV(needsTapToResume);
    subscribers.add(fn);
    fn();
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return v;
}
