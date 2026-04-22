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
 * Persistent mini player that sits above the bottom nav on every mobile tab.
 *
 * Visual contract (mobile+remote alignment pass):
 *   - transport buttons — previous, play/pause, next — are ALWAYS rendered.
 *     They dim via opacity when disabled, never hide behind menus.
 *   - volume stays OFF the mini-player so it remains a compact extension of
 *     the main SyncBiz dock. Volume lives in the Now Playing sheet, labelled
 *     per mode (MASTER vs this phone).
 *   - button chrome mirrors `playback-dock-surface.css`: slate gradient
 *     secondary buttons, emerald-glow primary button, rounded-xl corners.
 *
 * Tap rules:
 *   - tapping the artwork / title block opens the Now Playing sheet
 *   - tapping any transport button does NOT open the sheet (event stops)
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
          className="h-full bg-emerald-500 transition-[width] duration-200"
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
            className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-slate-800 ring-1 ring-slate-700/60 ${
              d.hasSource && d.isPlaying
                ? "shadow-[0_0_0_1px_rgba(30,215,96,0.35),0_0_14px_rgba(30,215,96,0.2)]"
                : ""
            }`}
            aria-hidden
          >
            {d.cover ? (
              <HydrationSafeImage src={d.cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <svg className="h-5 w-5 text-slate-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
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
              <p className="truncate text-[11px] font-medium leading-tight text-slate-400">
                {d.subtitle}
              </p>
            )}
          </div>
        </button>

        {/* Transport cluster — always visible. Chrome mirrors desktop dock. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onPrev();
            }}
            disabled={transportDisabled}
            aria-label="Previous"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700/80 bg-gradient-to-b from-slate-700/20 to-slate-900/95 text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_2px_6px_rgba(0,0,0,0.4)] transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-40 disabled:pointer-events-none"
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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/50 bg-gradient-to-b from-emerald-400/35 to-emerald-600/25 text-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.4),0_0_18px_rgba(30,215,96,0.22)] transition hover:border-emerald-400/70 hover:text-white active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
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
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700/80 bg-gradient-to-b from-slate-700/20 to-slate-900/95 text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_2px_6px_rgba(0,0,0,0.4)] transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-40 disabled:pointer-events-none"
          >
            <PlaybackTransportIconNext className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
