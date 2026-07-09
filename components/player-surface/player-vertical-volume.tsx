"use client";

import { useCallback, useId, useRef } from "react";

/**
 * Vertical VOLUME module — clean modern channel strip.
 * A slim rounded track with a round knob, numeric readout on top and a quiet
 * mute toggle below. Pointer capture / onChange / mute logic unchanged.
 */

export type PlayerVerticalVolumeProps = {
  /** 0–100 — already accounts for desktop / control-mirror branches in AudioPlayer. */
  value: number;
  onChange: (value: number) => void;
  /** Mute / unmute toggle. AudioPlayer owns the `volumeBeforeMuteRef` semantics. */
  onMuteToggle?: () => void;
  /** Kept for API compatibility; the clean design has no meter simulation. */
  isPlaying?: boolean;
  /** Localized aria label for the slider input itself. */
  ariaLabel?: string;
  /** Localized label for the mute toggle (used as both aria-label and title). */
  muteLabel?: string;
};

export function PlayerVerticalVolume({
  value,
  onChange,
  onMuteToggle,
  ariaLabel = "Volume",
  muteLabel = "Toggle mute",
}: PlayerVerticalVolumeProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const isMuted = v === 0;

  const insetRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const inputId = useId();

  const valueFromClientY = useCallback((clientY: number): number => {
    const el = insetRef.current;
    if (!el) return v;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return v;
    const y = clientY - rect.top;
    const ratio = 1 - Math.max(0, Math.min(1, y / rect.height));
    return Math.round(ratio * 100);
  }, [v]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      draggingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      e.preventDefault();
      inputRef.current?.focus({ preventScroll: true });
      onChange(valueFromClientY(e.clientY));
    },
    [onChange, valueFromClientY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      onChange(valueFromClientY(e.clientY));
    },
    [onChange, valueFromClientY],
  );

  const stopDragging = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }, []);

  return (
    <div
      className="vol-deck-shell relative flex h-full min-h-0 w-[64px] flex-col items-stretch overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] px-2 py-2 sm:w-[68px]"
      role="group"
      aria-label={ariaLabel}
    >
      <div className="shrink-0 flex flex-col items-center pb-1.5 pt-0.5">
        <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-[#6e6e73]">Vol</span>
        <span className="vol-deck-readout mt-0.5 text-[17px] font-semibold tabular-nums leading-none text-[#f5f5f7]">
          {v}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch justify-center px-0.5 py-1">
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          className="vol-deck-track relative flex h-full min-h-0 w-[28px] cursor-pointer select-none touch-none justify-center"
          role="presentation"
        >
          <div ref={insetRef} className="absolute inset-y-1 left-1/2 w-0 -translate-x-1/2">
            {/* Track */}
            <div
              className="absolute inset-y-0 left-1/2 w-[4px] -translate-x-1/2 rounded-full bg-white/[0.12]"
              aria-hidden
            />
            {/* Fill */}
            <div
              className="absolute bottom-0 left-1/2 w-[4px] -translate-x-1/2 rounded-full bg-[#f5f5f7]"
              style={{ height: `${v}%` }}
              aria-hidden
            />
            {/* Knob */}
            <div
              className="vol-deck-handle absolute left-1/2 z-10 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ top: `${100 - v}%` }}
              aria-hidden
            />
          </div>
        </div>
      </div>

      <div className="mt-1 shrink-0 flex flex-col items-center pb-0.5">
        <button
          type="button"
          onClick={onMuteToggle}
          aria-label={muteLabel}
          aria-pressed={isMuted}
          title={muteLabel}
          className={`vol-deck-mute-btn flex h-8 w-8 items-center justify-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 ${
            isMuted
              ? "border-[#ff453a]/35 bg-[#ff453a]/12 text-[#ff453a]"
              : "border-white/[0.08] bg-white/[0.04] text-[#a1a1a6] hover:border-white/[0.16] hover:text-[#f5f5f7]"
          }`}
        >
          <MuteIcon muted={isMuted} />
        </button>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="range"
        min={0}
        max={100}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        className="vol-deck-input-a11y"
      />
    </div>
  );
}

function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M3.5 6h2L8 4v8L5.5 10h-2A.5.5 0 0 1 3 9.5v-3A.5.5 0 0 1 3.5 6Z"
        fill="currentColor"
        stroke="none"
      />
      {muted ? (
        <>
          <path d="M10.5 6.5l3 3" />
          <path d="M13.5 6.5l-3 3" />
        </>
      ) : (
        <>
          <path d="M10.5 6.2c.9 1.1.9 2.5 0 3.6" />
          <path d="M12.4 5c1.6 1.8 1.6 4.2 0 6" />
        </>
      )}
    </svg>
  );
}
