"use client";

import { useState } from "react";

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
      {/* Transport rail – raised deck surface */}
      <div
        className={`flex items-center gap-1.5 rounded-2xl border border-slate-700/80 bg-slate-900/90 px-2 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_4px_12px_rgba(0,0,0,0.4)] sm:gap-2 sm:px-3 sm:py-2.5 ${
          compact ? "rounded-r-none border-r-0" : ""
        }`}
      >
        {/* Play – primary transport, larger, emerald */}
        <button
          type="button"
          onClick={handlePlay}
          disabled={disabled || busy}
          aria-label={loading === "play" ? "Sending…" : "Play"}
          className={`
            flex items-center justify-center rounded-full
            border border-emerald-500/40
            bg-gradient-to-b from-emerald-400/25 to-emerald-600/30
            text-emerald-200
            shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_2px_4px_rgba(0,0,0,0.4),0_0_20px_rgba(16,185,129,0.12)]
            transition-all duration-100
            hover:border-emerald-400/60 hover:from-emerald-400/30 hover:to-emerald-500/40
            hover:shadow-[0_1px_0_0_rgba(255,255,255,0.1)_inset,0_3px_6px_rgba(0,0,0,0.35),0_0_28px_rgba(16,185,129,0.2)]
            active:scale-[0.96]
            active:shadow-[0_2px_0_0_rgba(0,0,0,0.3)_inset,0_1px_2px_rgba(0,0,0,0.5)]
            disabled:opacity-50 disabled:pointer-events-none
            focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:ring-offset-2 focus:ring-offset-slate-900
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
            border border-slate-600/80
            bg-gradient-to-b from-slate-500/20 to-slate-800/90
            text-slate-300
            shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset,0_2px_4px_rgba(0,0,0,0.35)]
            transition-all duration-100
            hover:border-slate-500/80 hover:from-slate-400/25 hover:to-slate-700/80
            hover:text-slate-100
            hover:shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_3px_6px_rgba(0,0,0,0.3)]
            active:scale-[0.96]
            active:shadow-[0_2px_0_0_rgba(0,0,0,0.25)_inset,0_1px_2px_rgba(0,0,0,0.4)]
            disabled:opacity-50 disabled:pointer-events-none
            focus:outline-none focus:ring-2 focus:ring-slate-400/30 focus:ring-offset-2 focus:ring-offset-slate-900
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
            border border-slate-600/80
            bg-gradient-to-b from-slate-500/20 to-slate-800/90
            text-slate-300
            shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset,0_2px_4px_rgba(0,0,0,0.35)]
            transition-all duration-100
            hover:border-slate-500/80 hover:from-slate-400/25 hover:to-slate-700/80
            hover:text-slate-100
            hover:shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_3px_6px_rgba(0,0,0,0.3)]
            active:scale-[0.96]
            active:shadow-[0_2px_0_0_rgba(0,0,0,0.25)_inset,0_1px_2px_rgba(0,0,0,0.4)]
            disabled:opacity-50 disabled:pointer-events-none
            focus:outline-none focus:ring-2 focus:ring-slate-400/30 focus:ring-offset-2 focus:ring-offset-slate-900
            ${secondarySize}
          `}
        >
          <IconStop className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </button>
      </div>

      {/* Volume fader strip – deck-style */}
      <div
        className={`flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/90 px-3 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03),0_2px_8px_rgba(0,0,0,0.3)] ${
          compact ? "rounded-l-none border-l-slate-700/80 pl-3" : "ml-1 border-l border-slate-700/80 pl-4"
        }`}
      >
        <IconVolume className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          disabled={disabled}
          className="h-1.5 w-20 shrink-0 appearance-none rounded-full bg-slate-700/80 focus:outline-none focus:ring-0 sm:w-24 [&::-webkit-slider-thumb]:cursor-pointer"
          aria-label="Volume"
        />
        <span className="w-7 text-end text-xs font-semibold tabular-nums text-slate-400">
          {volume}
        </span>
      </div>
    </div>
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
        border border-[#1db954]/40
        bg-gradient-to-b from-[#1ed760]/20 to-[#1db954]/25
        px-3.5 py-2 text-sm font-medium text-[#1ed760]
        shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_2px_6px_rgba(0,0,0,0.3),0_0_16px_rgba(30,215,96,0.12)]
        transition-all duration-150
        hover:border-[#1ed760]/60 hover:from-[#1ed760]/28 hover:to-[#1db954]/35 hover:text-white
        hover:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_3px_8px_rgba(0,0,0,0.25),0_0_22px_rgba(30,215,96,0.2)]
        active:scale-[0.98]
        active:shadow-[0_2px_0_0_rgba(0,0,0,0.2)_inset,0_1px_3px_rgba(0,0,0,0.4)]
        disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none
        focus:outline-none focus:ring-2 focus:ring-[#1ed760]/40 focus:ring-offset-2 focus:ring-offset-slate-900
      `}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1db954]/30 bg-[#1db954]/20 shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_1px_3px_rgba(0,0,0,0.3)]"
        aria-hidden
      >
        <svg className="h-4 w-4 text-[#1ed760]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7L8 5z" />
        </svg>
      </span>
      {loading ? loadingLabel : label}
    </button>
  );
}
