"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * Vertical VOLUME module — CDJ-style channel strip.
 * Pointer capture / onChange / mute logic unchanged.
 */

const SEGMENTS = 20; /* tick overlay density in CSS — visual only */

export type PlayerVerticalVolumeProps = {
  /** 0–100 — already accounts for desktop / control-mirror branches in AudioPlayer. */
  value: number;
  onChange: (value: number) => void;
  /** Mute / unmute toggle. AudioPlayer owns the `volumeBeforeMuteRef` semantics. */
  onMuteToggle?: () => void;
  /** When true, the LED VU-meter simulation and pulse animation are active. */
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
  isPlaying = false,
  ariaLabel = "Volume",
  muteLabel = "Toggle mute",
}: PlayerVerticalVolumeProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const isMuted = v === 0;

  const [meterLevels, setMeterLevels] = useState({ l: v, r: v });
  useEffect(() => {
    if (!isPlaying || v === 0) {
      setMeterLevels({ l: v, r: v });
      return;
    }
    const tick = () => {
      const variationL = (Math.random() - 0.42) * 22;
      const variationR = (Math.random() - 0.38) * 24;
      const l = Math.round(Math.max(Math.max(0, v - 28), Math.min(100, v + variationL)));
      const r = Math.round(Math.max(Math.max(0, v - 30), Math.min(100, v + variationR)));
      setMeterLevels({ l, r });
    };
    tick();
    const id = setInterval(tick, 120);
    return () => clearInterval(id);
  }, [v, isPlaying]);

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
      className="vol-deck-shell relative flex h-full min-h-0 w-[76px] flex-col items-stretch overflow-hidden rounded-lg border border-slate-700/35 bg-slate-900/90 px-2 py-1.5 sm:w-[80px]"
      role="group"
      aria-label={ariaLabel}
    >
      <div className="shrink-0 flex flex-col items-center pb-1 pt-0.5">
        <span className="text-[8px] font-semibold uppercase tracking-[0.2em] text-slate-600">Vol</span>
        <span className="vol-deck-readout mt-0.5 font-mono text-[20px] font-semibold tabular-nums leading-none text-slate-100 sm:text-[22px]">
          {String(v).padStart(2, "0")}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-2 px-0.5 py-0.5">
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          className="vol-deck-track relative flex h-full min-h-0 w-[22px] flex-1 cursor-pointer select-none touch-none"
          role="presentation"
        >
          <div ref={insetRef} className="absolute inset-0">
            <div
              className="absolute inset-y-0 left-1/2 w-[5px] -translate-x-1/2 rounded-sm bg-[#050505] shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)]"
              aria-hidden
            />
            <div
              className="absolute bottom-0 left-1/2 w-[5px] -translate-x-1/2 rounded-sm bg-gradient-to-t from-neutral-500 via-neutral-300 to-neutral-100"
              style={{ height: `${v}%` }}
              aria-hidden
            />
            <div
              className="vol-deck-handle absolute left-1/2 z-10 h-[10px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-[3px]"
              style={{ top: `${100 - v}%` }}
              aria-hidden
            />
          </div>
        </div>

        <div
          className={`vol-deck-meter-bank flex h-full min-h-0 shrink-0 items-stretch gap-[3px] py-0 transition-opacity duration-200 ${isPlaying ? "opacity-100" : "opacity-45 pointer-events-none"}`}
          aria-hidden
        >
          {(["L", "R"] as const).map((channel) => {
            const level = channel === "L" ? meterLevels.l : meterLevels.r;
            const pct = Math.max(0, Math.min(100, level));
            return (
              <div
                key={channel}
                className="vol-deck-meter-column relative h-full w-[5px] min-h-0 overflow-hidden rounded-[2px]"
              >
                <div
                  className="vol-deck-meter-level absolute bottom-0 left-0 right-0"
                  style={{ height: `${pct}%` }}
                />
                <div className="vol-deck-meter-ticks pointer-events-none absolute inset-0" aria-hidden />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1 shrink-0 flex flex-col items-center pb-0.5">
        <button
          type="button"
          onClick={onMuteToggle}
          aria-label={muteLabel}
          aria-pressed={isMuted}
          title={muteLabel}
          className={`vol-deck-mute-btn flex h-8 w-8 items-center justify-center rounded-[5px] border transition-colors focus:outline-none focus:ring-1 focus:ring-white/20 ${
            isMuted
              ? "border-rose-500/40 bg-rose-950/30 text-rose-200/90"
              : "border-white/[0.08] bg-[#0d0d0d] text-slate-500 hover:border-white/14 hover:text-slate-300"
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
