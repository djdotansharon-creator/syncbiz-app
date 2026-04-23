"use client";

import { useMemo } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { useMobilePlayer } from "@/components/mobile/mobile-now-playing-sheet";
import {
  PlaybackTransportIconNext,
  PlaybackTransportIconPause,
  PlaybackTransportIconPlay,
  PlaybackTransportIconPrev,
} from "@/components/player-surface/playback-transport-icons";

type Props = {
  /** Called when the user taps the artwork / title area to open the full Now Playing sheet. */
  onOpen: () => void;
};

/**
 * Persistent mini player pinned above the bottom nav on every mobile tab.
 *
 * Visual contract: speaks the same language as `PlayerHeroSurface` (the main
 * SyncBiz player on `/player`) — `rounded-2xl` chrome, solid `#1db954`
 * primary with a white glyph, plain slate secondary. Transport stays always
 * visible; volume lives in the full Now Playing sheet to keep this bar
 * compact.
 *
 * Tap rules:
 *   - tapping artwork / title opens the Now Playing sheet
 *   - tapping a transport button does NOT open the sheet (event stops)
 */
export function MobileMiniPlayer({ onOpen }: Props) {
  const d = useMobilePlayer();

  const progressPct = useMemo(() => {
    if (!d.duration || d.duration <= 0) return 0;
    return Math.max(0, Math.min(100, (d.position / d.duration) * 100));
  }, [d.position, d.duration]);

  const transportDisabled = !d.canControl || !d.hasSource;

  return (
    <div
      className="relative border-t border-slate-800/80 bg-slate-950/96 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur"
      role="region"
      aria-label="Mini player"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-slate-800/60"
      >
        <div
          className="h-full bg-[#1db954] transition-[width] duration-200"
          style={{ width: d.hasSource ? `${progressPct}%` : "0%" }}
        />
      </div>

      <div className="flex items-center gap-2 px-2.5 py-2.5">
        <button
          type="button"
          onClick={onOpen}
          aria-label={d.hasSource ? "Open Now Playing" : "Open player"}
          className="flex min-w-0 flex-1 items-center gap-3 text-left transition active:scale-[0.99]"
        >
          <div
            className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-800 ring-1 ring-slate-700/60 ${
              d.hasSource && d.isPlaying ? "ring-[#1db954]/50" : ""
            }`}
            aria-hidden
          >
            {d.cover ? (
              <HydrationSafeImage src={d.cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <svg className="h-5 w-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <p
              className={`truncate text-[13px] font-semibold leading-tight ${
                d.hasSource ? "text-slate-100" : "text-slate-400"
              }`}
            >
              {d.title}
            </p>
            {d.subtitle && (
              <p className="truncate text-[11px] font-medium uppercase leading-tight tracking-wide text-slate-500">
                {d.subtitle}
              </p>
            )}
          </div>
        </button>

        {/* Transport cluster — always visible. Same language as `/player` hero. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onPrev();
            }}
            disabled={transportDisabled}
            aria-label="Previous"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/80 text-slate-300 transition hover:bg-slate-800 hover:text-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            <PlaybackTransportIconPrev className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onPlayPause();
            }}
            disabled={!d.canControl || !d.hasSource}
            aria-label={d.isPlaying ? "Pause" : "Play"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1db954] text-white shadow-[0_6px_12px_-3px_rgba(0,0,0,0.35)] transition hover:bg-[#1ed760] active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {d.isPlaying ? (
              <PlaybackTransportIconPause className="h-5 w-5" />
            ) : (
              <PlaybackTransportIconPlay className="ml-0.5 h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onNext();
            }}
            disabled={transportDisabled}
            aria-label="Next"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/80 text-slate-300 transition hover:bg-slate-800 hover:text-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            <PlaybackTransportIconNext className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
