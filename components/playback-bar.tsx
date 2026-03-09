"use client";

import { usePlayback } from "@/lib/playback-context";
import { useTranslations } from "@/lib/locale-context";

const secondaryBtn =
  "flex items-center justify-center rounded-xl border border-slate-600/80 bg-gradient-to-b from-slate-500/15 to-slate-800/90 text-slate-300 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_2px_6px_rgba(0,0,0,0.4)] transition-all duration-150 hover:border-slate-500 hover:from-slate-400/25 hover:to-slate-700/80 hover:text-slate-100 hover:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_4px_12px_rgba(0,0,0,0.35)] active:scale-[0.96] active:shadow-[0_3px_0_0_rgba(0,0,0,0.2)_inset] focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none disabled:hover:shadow-none";

const playBtn =
  "flex items-center justify-center rounded-xl border border-[#1db954]/50 bg-gradient-to-b from-[#1ed760]/35 to-[#1db954]/25 text-[#1ed760] shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset,0_4px_16px_rgba(0,0,0,0.4),0_0_32px_rgba(30,215,96,0.25)] transition-all duration-150 hover:border-[#1ed760]/70 hover:from-[#1ed760]/45 hover:to-[#1db954]/35 hover:text-white hover:shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_6px_20px_rgba(0,0,0,0.35),0_0_40px_rgba(30,215,96,0.35)] active:scale-[0.96] active:shadow-[0_3px_0_0_rgba(0,0,0,0.25)_inset,0_0_24px_rgba(30,215,96,0.2)] focus:outline-none focus:ring-2 focus:ring-[#1ed760]/50 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-40 disabled:pointer-events-none";

function IconPrev() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
    </svg>
  );
}
function IconStop() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}
function IconPlay() {
  return (
    <svg className="h-8 w-8 ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}
function IconPause() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}
function IconNext() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 18V6h2v12H6zm11-6l-8.5 6V6l8.5 6z" />
    </svg>
  );
}
function IconVolume() {
  return (
    <svg className="h-5 w-5 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
    </svg>
  );
}

export function PlaybackBar() {
  const {
    currentSource,
    status,
    volume,
    setVolume,
    play,
    pause,
    stop,
    prev,
    next,
    lastMessage,
  } = usePlayback();
  const { t } = useTranslations();

  const hasSource = !!currentSource;
  const canPrevNext = hasSource;

  const statusSubtext = lastMessage
    ? t.commandSent
    : hasSource
      ? status === "playing"
        ? t.playing
        : status === "paused"
          ? t.paused
          : t.stopped
      : t.noSourceSelected;
  const titleText = hasSource ? currentSource!.name : lastMessage || t.stopped;

  return (
    <footer
      className="fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 py-4"
      role="region"
      aria-label="Playback controls"
    >
      <div className="flex w-full max-w-3xl flex-col items-center gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/80 px-6 py-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset,0_4px_24px_rgba(0,0,0,0.5),0_0_1px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        {/* Now playing */}
        <div className="w-full min-w-0 text-center">
          <p className="truncate text-sm font-medium text-slate-200">
            {titleText}
          </p>
          <p className="truncate text-xs text-slate-500">
            {statusSubtext}
          </p>
        </div>

        {/* Transport – centered, large, tactile */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={prev}
            disabled={!canPrevNext}
            className={`h-12 w-12 ${secondaryBtn}`}
            aria-label="Previous"
          >
            <IconPrev />
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={!hasSource}
            className={`h-12 w-12 ${secondaryBtn}`}
            aria-label="Stop"
          >
            <IconStop />
          </button>
          <button
            type="button"
            onClick={play}
            disabled={!hasSource}
            className={`h-16 w-16 ${playBtn}`}
            aria-label="Play"
          >
            <IconPlay />
          </button>
          <button
            type="button"
            onClick={pause}
            disabled={!hasSource}
            className={`h-12 w-12 ${secondaryBtn}`}
            aria-label="Pause"
          >
            <IconPause />
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!canPrevNext}
            className={`h-12 w-12 ${secondaryBtn}`}
            aria-label="Next"
          >
            <IconNext />
          </button>
        </div>

        {/* Volume – full width for easier grab */}
        <div className="flex w-full max-w-xs items-center gap-3">
          <IconVolume />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="h-2 w-full appearance-none rounded-full bg-slate-700/80 focus:outline-none [&::-webkit-slider-thumb]:cursor-pointer"
            aria-label="Volume"
          />
          <span className="w-8 text-end text-sm font-semibold tabular-nums text-slate-400">
            {volume}
          </span>
        </div>
      </div>
    </footer>
  );
}
