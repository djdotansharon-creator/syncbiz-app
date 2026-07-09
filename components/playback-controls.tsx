"use client";

import { useState, useEffect, useCallback } from "react";

/** Transport-style icons – crisp, centered, deck-ready */
function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}
function IconPause({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}
function IconStop({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}
function IconVolume({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
    </svg>
  );
}

type PlaybackControlsProps = {
  onPlay?: () => void | Promise<void>;
  onPause?: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  volume?: number;
  onVolumeChange?: (value: number) => void;
  compact?: boolean;
  disabled?: boolean;
};

export function PlaybackControls({
  onPlay,
  onPause,
  onStop,
  volume: controlledVolume,
  onVolumeChange,
  compact = false,
  disabled = false,
}: PlaybackControlsProps) {
  const [internalVolume, setInternalVolume] = useState(50);
  const volume = controlledVolume ?? internalVolume;
  const setVolume = onVolumeChange ?? setInternalVolume;

  // Draft volume for immediate UI updates while dragging; commit only on release
  const [draftVolume, setDraftVolume] = useState(() => volume);
  useEffect(() => {
    setDraftVolume(volume);
  }, [volume]);

  const commitVolume = useCallback(() => {
    const clamped = Math.max(0, Math.min(100, Math.round(draftVolume)));
    setVolume(clamped);
  }, [draftVolume, setVolume]);

  const [loading, setLoading] = useState<"play" | "pause" | "stop" | null>(null);
  const busy = loading !== null;

  async function handlePlay() {
    if (disabled || busy) return;
    setLoading("play");
    try {
      await onPlay?.();
    } finally {
      setLoading(null);
    }
  }
  async function handlePause() {
    if (disabled || busy) return;
    setLoading("pause");
    try {
      await onPause?.();
    } finally {
      setLoading(null);
    }
  }
  async function handleStop() {
    if (disabled || busy) return;
    setLoading("stop");
    try {
      await onStop?.();
    } finally {
      setLoading(null);
    }
  }

  const playSize = compact ? "h-11 w-11" : "h-14 w-14";
  const secondarySize = compact ? "h-10 w-10" : "h-12 w-12";

  return (
    <div
      className="flex flex-wrap items-center gap-2 sm:gap-3"
      role="group"
      aria-label="Playback controls"
    >
      {/* Transport rail – quiet surface */}
      <div
        className={`flex items-center gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-2 py-2 sm:gap-2 sm:px-3 sm:py-2.5 ${
          compact ? "rounded-r-none border-r-0" : ""
        }`}
      >
        {/* Play – primary transport: solid white circle, dark glyph */}
        <button
          type="button"
          onClick={handlePlay}
          disabled={disabled || busy}
          aria-label={loading === "play" ? "Sending…" : "Play"}
          className={`
            flex items-center justify-center rounded-full
            bg-[#f5f5f7] text-[#111114]
            shadow-[0_4px_16px_-6px_rgba(0,0,0,0.55)]
            transition-colors duration-150
            hover:bg-white hover:text-black
            active:scale-[0.96]
            disabled:opacity-50 disabled:pointer-events-none
            focus:outline-none focus:ring-2 focus:ring-white/30
            ${playSize}
          `}
        >
          <IconPlay className={compact ? "h-5 w-5 ml-0.5" : "h-7 w-7 ml-0.5"} />
        </button>

        {/* Pause */}
        <button
          type="button"
          onClick={handlePause}
          disabled={disabled || busy}
          aria-label={loading === "pause" ? "Sending…" : "Pause"}
          className={`
            flex items-center justify-center rounded-full
            border border-white/[0.08] bg-white/[0.05] text-[#a1a1a6]
            transition-colors duration-150
            hover:border-white/[0.16] hover:bg-white/[0.09] hover:text-[#f5f5f7]
            active:scale-[0.96]
            disabled:opacity-50 disabled:pointer-events-none
            focus:outline-none focus:ring-2 focus:ring-white/25
            ${secondarySize}
          `}
        >
          <IconPause className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </button>

        {/* Stop */}
        <button
          type="button"
          onClick={handleStop}
          disabled={disabled || busy}
          aria-label={loading === "stop" ? "Sending…" : "Stop"}
          className={`
            flex items-center justify-center rounded-full
            border border-white/[0.08] bg-white/[0.05] text-[#a1a1a6]
            transition-colors duration-150
            hover:border-white/[0.16] hover:bg-white/[0.09] hover:text-[#f5f5f7]
            active:scale-[0.96]
            disabled:opacity-50 disabled:pointer-events-none
            focus:outline-none focus:ring-2 focus:ring-white/25
            ${secondarySize}
          `}
        >
          <IconStop className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </button>
      </div>

      {/* Volume fader strip – quiet surface */}
      <div
        className={`flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 ${
          compact ? "rounded-l-none pl-3" : "ml-1 pl-4"
        }`}
      >
        <IconVolume className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        <VolumeLedFader
          value={draftVolume}
          onChange={setDraftVolume}
          onCommit={commitVolume}
          disabled={disabled}
          compact={compact}
        />
        <span className="w-7 text-end text-xs font-semibold tabular-nums text-slate-400">
          {draftVolume}
        </span>
      </div>
    </div>
  );
}

const VOLUME_LED_SEGMENT_COUNT = 12;

function VolumeLedFader({
  value,
  onChange,
  onCommit,
  disabled,
  compact,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  // Lit-segment count tracks the slider value. Final segment lights only at full
  // volume so the readout never lies — the LED row exactly mirrors the input.
  const litCount = Math.round((Math.max(0, Math.min(100, value)) / 100) * VOLUME_LED_SEGMENT_COUNT);
  return (
    <span
      className={`relative inline-flex shrink-0 ${compact ? "w-20" : "w-24"} h-5 items-center sm:w-28`}
    >
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onKeyUp={onCommit}
        disabled={disabled}
        className="volume-led-input"
        aria-label="Volume"
      />
      <span aria-hidden className="volume-led-track">
        {Array.from({ length: VOLUME_LED_SEGMENT_COUNT }).map((_, i) => {
          const on = i < litCount;
          // Last 2 segments warn (yellow), final segment hot (red) — classic VU palette.
          const warm = on && i >= VOLUME_LED_SEGMENT_COUNT - 3 && i < VOLUME_LED_SEGMENT_COUNT - 1;
          const hot = on && i >= VOLUME_LED_SEGMENT_COUNT - 1;
          return (
            <span
              key={i}
              className={`volume-led-seg${on ? " is-on" : ""}${warm ? " is-warm" : ""}${hot ? " is-hot" : ""}`}
            />
          );
        })}
      </span>
    </span>
  );
}

/** Single "Play" transport button for rows/cards – same deck language */
export function PlayNowButton({
  onClick,
  disabled,
  loading,
  label = "Play now",
  loadingLabel = "Sending…",
}: {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  loadingLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={loading ? loadingLabel : label}
      className={`
        inline-flex items-center justify-center gap-2 rounded-xl
        border border-white/[0.1] bg-white/[0.06]
        px-3.5 py-2 text-sm font-medium text-[#f5f5f7]
        transition-colors duration-150
        hover:border-white/[0.18] hover:bg-white/[0.1]
        active:scale-[0.98]
        disabled:opacity-50 disabled:pointer-events-none
        focus:outline-none focus:ring-2 focus:ring-white/25
      `}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7]"
        aria-hidden
      >
        <svg className="h-4 w-4 ml-0.5 text-[#111114]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7L8 5z" />
        </svg>
      </span>
      {loading ? loadingLabel : label}
    </button>
  );
}
