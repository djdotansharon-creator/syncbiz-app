/**
 * A/B deck transition engine — shared crossfade math, lock, and preload timing.
 * AudioPlayer owns the DOM elements; this module owns transition orchestration rules.
 */

/** Seconds before track end to begin standby preload (buffer/cache). */
export const PRELOAD_LEAD_SEC = 20;

/** Max wait for standby source to become playable before starting fade anyway. */
export const STANDBY_READY_TIMEOUT_MS = 12_000;

export type DeckId = "A" | "B";

export type DeckTransitionLock = {
  isLocked: () => boolean;
  tryAcquire: () => boolean;
  release: () => void;
  /** Run fn after the current transition completes (or immediately if idle). */
  queueAfter: (fn: () => void) => void;
  /** Explicit STOP — cancel any queued transition without running it. */
  forceReset: () => void;
};

export function createDeckTransitionLock(): DeckTransitionLock {
  let locked = false;
  let queued: (() => void) | null = null;

  return {
    isLocked: () => locked,
    tryAcquire: () => {
      if (locked) return false;
      locked = true;
      return true;
    },
    release: () => {
      locked = false;
      if (queued) {
        const fn = queued;
        queued = null;
        fn();
      }
    },
    queueAfter: (fn) => {
      if (!locked) {
        fn();
        return;
      }
      queued = fn;
    },
    forceReset: () => {
      locked = false;
      queued = null;
    },
  };
}

export type CrossfadeCurve = "linear" | "equalPower" | "smoothstep";

export type VolumeCrossfadeCallbacks = {
  onComplete: () => void;
  onError: () => void;
  isAborted: () => boolean;
  getStatus?: () => string;
  /** Perceptual mix curve — default equalPower for embed crossfades. */
  curve?: CrossfadeCurve;
  /** Min ms between volume writes (YouTube API is coarse; default 40ms). */
  minUpdateIntervalMs?: number;
  /** Optional diagnostics — receives UI volumes 0..targetVolume and linear elapsed frac. */
  onFadeTick?: (outVol: number, inVol: number, frac: number) => void;
};

/** Perceptual gain pair for constant-power overlap (out² + in² ≈ 1). */
export function mixCrossfadeGains(
  frac: number,
  curve: CrossfadeCurve = "equalPower",
): { outGain: number; inGain: number } {
  const t = Math.max(0, Math.min(1, frac));
  switch (curve) {
    case "linear":
      return { outGain: 1 - t, inGain: t };
    case "smoothstep": {
      const s = t * t * (3 - 2 * t);
      return { outGain: 1 - s, inGain: s };
    }
    case "equalPower":
    default: {
      const angle = t * (Math.PI / 2);
      return { outGain: Math.cos(angle), inGain: Math.sin(angle) };
    }
  }
}

/**
 * True overlap crossfade between two HTMLMediaElements (direct audio URL path).
 * Returns abort handle. On success, `incoming` is audible at targetVolume; caller swaps decks.
 */
export function runDeckVolumeCrossfade(
  outgoing: HTMLAudioElement,
  incoming: HTMLAudioElement,
  targetVolume: number,
  durationSec: number,
  callbacks: VolumeCrossfadeCallbacks,
): () => void {
  const { onComplete, onError, isAborted, getStatus, onFadeTick } = callbacks;
  const startMs = Date.now();
  const durationMs = Math.max(100, durationSec * 1000);
  let completed = false;
  let rafId: number | null = null;
  let fadeTickLogged = false;

  const finish = (success: boolean) => {
    if (completed) return;
    completed = true;
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!success) {
      outgoing.volume = targetVolume;
      incoming.pause();
      incoming.volume = 0;
    }
    if (success) onComplete();
    else onError();
  };

  const tick = () => {
    if (isAborted()) {
      finish(false);
      return;
    }
    const elapsed = Date.now() - startMs;
    const frac = Math.min(1, elapsed / durationMs);
    const outVol = Math.max(0, targetVolume * (1 - frac));
    const inVol = targetVolume * frac;
    outgoing.volume = outVol;
    incoming.volume = inVol;
    if (!fadeTickLogged) {
      fadeTickLogged = true;
      onFadeTick?.(outVol, inVol, frac);
    }

    if (frac >= 1) {
      outgoing.pause();
      outgoing.currentTime = 0;
      outgoing.volume = targetVolume;
      incoming.volume = targetVolume;
      const st = getStatus?.() ?? "playing";
      if (st === "playing" && incoming.paused) {
        incoming.play().catch(() => {});
      }
      finish(true);
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => finish(false);
}

/** Preload threshold: start buffering standby this many seconds before mix point. */
export function preloadThresholdSec(trackDurationSec: number, mixSec: number): number {
  const mixPoint = Math.max(0, trackDurationSec - mixSec);
  return Math.max(0, mixPoint - PRELOAD_LEAD_SEC);
}

/** Mix point: begin audible crossfade this many seconds before track end. */
export function mixPointThresholdSec(trackDurationSec: number, mixSec: number): number {
  return Math.max(0, trackDurationSec - mixSec);
}

/**
 * Generic dual-channel volume crossfade (YouTube iframe API, SoundCloud widget, etc.).
 * `setOutVol` / `setInVol` receive linear 0–1 fractions of `targetVolume`.
 */
export function runDualVolumeCrossfade(
  setOutVol: (vol: number) => void,
  setInVol: (vol: number) => void,
  targetVolume: number,
  durationSec: number,
  callbacks: VolumeCrossfadeCallbacks,
): () => void {
  const {
    onComplete,
    onError,
    isAborted,
    onFadeTick,
    curve = "equalPower",
    minUpdateIntervalMs = 40,
  } = callbacks;
  const startMs = Date.now();
  const durationMs = Math.max(100, durationSec * 1000);
  const maxVol = Math.max(0, Math.min(100, Math.round(targetVolume)));
  let completed = false;
  let rafId: number | null = null;
  let lastUpdateMs = 0;
  let lastOutSent = -1;
  let lastInSent = -1;

  const applyVolumes = (outUi: number, inUi: number, frac: number, force = false) => {
    const outClamped = Math.max(0, Math.min(maxVol, Math.round(outUi)));
    const inClamped = Math.max(0, Math.min(maxVol, Math.round(inUi)));
    const now = Date.now();
    const changed = outClamped !== lastOutSent || inClamped !== lastInSent;
    if (!force && !changed) return;
    if (!force && now - lastUpdateMs < minUpdateIntervalMs) return;
    lastUpdateMs = now;
    lastOutSent = outClamped;
    lastInSent = inClamped;
    setOutVol(outClamped);
    setInVol(inClamped);
    onFadeTick?.(outClamped, inClamped, frac);
  };

  const finish = (success: boolean) => {
    if (completed) return;
    completed = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    if (!success) {
      setOutVol(maxVol);
      setInVol(0);
      onError();
    } else {
      setOutVol(0);
      setInVol(maxVol);
      onFadeTick?.(0, maxVol, 1);
      onComplete();
    }
  };

  const tick = () => {
    if (isAborted()) {
      finish(false);
      return;
    }
    const frac = Math.min(1, (Date.now() - startMs) / durationMs);
    if (frac >= 1) {
      finish(true);
      return;
    }
    const { outGain, inGain } = mixCrossfadeGains(frac, curve);
    applyVolumes(maxVol * outGain, maxVol * inGain, frac);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => finish(false);
}

/** Fade a single element's volume (HLS / limited-overlap fallback). */
export function runVolumeFade(
  el: HTMLMediaElement,
  fromVol: number,
  toVol: number,
  durationSec: number,
  callbacks: { onComplete: () => void; isAborted?: () => boolean },
): () => void {
  const startMs = Date.now();
  const durationMs = Math.max(100, durationSec * 1000);
  let rafId: number | null = null;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    callbacks.onComplete();
  };

  const tick = () => {
    if (callbacks.isAborted?.()) {
      finish();
      return;
    }
    const frac = Math.min(1, (Date.now() - startMs) / durationMs);
    el.volume = fromVol + (toVol - fromVol) * frac;
    if (frac >= 1) finish();
    else rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return finish;
}
