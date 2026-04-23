"use client";

import { useMemo } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import {
  MOBILE_TRANSPORT_PRIMARY,
  MOBILE_TRANSPORT_SEC,
  useMobilePlayer,
} from "@/components/mobile/mobile-now-playing-sheet";
import {
  PlaybackTransportIconNext,
  PlaybackTransportIconPause,
  PlaybackTransportIconPlay,
  PlaybackTransportIconPrev,
} from "@/components/player-surface/playback-transport-icons";

type Variant = "bottom-dock" | "top-card";

type Props = {
  /** Called when the user taps the artwork / title area to open the full Now Playing sheet. */
  onOpen: () => void;
  /**
   * Where this instance is rendered:
   *   - `bottom-dock` (default): pinned above the bottom nav, top border + up-shadow.
   *   - `top-card`: inline at the top of a page (e.g. `/mobile/home`). Full
   *     rounded card, shadow pointing down, reads as part of the page design.
   */
  variant?: Variant;
};

/**
 * Compact mobile player bar.
 *
 * Visual language (shared with the Now Playing sheet): cyan "neon pill"
 * transport buttons, circular artwork with a cyan ring when playing, slim
 * cyan progress bar. Mirrors the main SyncBiz player's deck transport
 * (`.library-deck-neon-btn:not(.h-7)` + `.library-deck-art-host` in
 * `app/globals.css`) so both devices feel like one product.
 *
 * Tap rules:
 *   - tapping artwork / title opens the Now Playing sheet
 *   - tapping a transport button does NOT open the sheet (event stops)
 */
export function MobileMiniPlayer({ onOpen, variant = "bottom-dock" }: Props) {
  const d = useMobilePlayer();

  const progressPct = useMemo(() => {
    if (!d.duration || d.duration <= 0) return 0;
    return Math.max(0, Math.min(100, (d.position / d.duration) * 100));
  }, [d.position, d.duration]);

  const transportDisabled = !d.canControl || !d.hasSource;

  const containerCls =
    variant === "top-card"
      ? "relative rounded-2xl border border-cyan-400/25 bg-slate-950/80 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.55),0_0_24px_-12px_rgba(34,211,238,0.35)] backdrop-blur"
      : "relative border-t border-slate-800/80 bg-slate-950/96 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur";

  // Progress bar: slim cyan, pinned to the top edge of the bar in both variants.
  const progressTrackCls =
    variant === "top-card"
      ? "pointer-events-none absolute inset-x-3 top-0 h-[2px] overflow-hidden rounded-full bg-slate-800/60"
      : "pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-slate-800/60";

  return (
    <div className={containerCls} role="region" aria-label="Mini player">
      <div aria-hidden className={progressTrackCls}>
        <div
          className="h-full bg-cyan-400/90 shadow-[0_0_8px_rgba(34,211,238,0.55)] transition-[width] duration-200"
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
          {/* Circular artwork with a cyan ring when playing — matches the
              main SyncBiz player's `.library-deck-art-host`. */}
          <div
            className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-slate-800 ${
              d.hasSource && d.isPlaying
                ? "ring-2 ring-cyan-400/70 shadow-[0_0_16px_-2px_rgba(34,211,238,0.45)]"
                : "ring-2 ring-slate-700/70"
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

        {/* Transport cluster — always visible, same cyan-neon language as the
            Now Playing sheet. Compact sizes so the bar stays mini-height. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onPrev();
            }}
            disabled={transportDisabled}
            aria-label="Previous"
            className={`${MOBILE_TRANSPORT_SEC} h-9 w-9`}
          >
            <PlaybackTransportIconPrev className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onPlayPause();
            }}
            disabled={!d.canControl || !d.hasSource}
            aria-label={d.isPlaying ? "Pause" : "Play"}
            className={`${MOBILE_TRANSPORT_PRIMARY} h-9 w-[3.75rem]`}
          >
            {d.isPlaying ? (
              <PlaybackTransportIconPause className="h-4 w-4" />
            ) : (
              <PlaybackTransportIconPlay className="ml-0.5 h-4 w-4" />
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
            className={`${MOBILE_TRANSPORT_SEC} h-9 w-9`}
          >
            <PlaybackTransportIconNext className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
