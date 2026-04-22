"use client";

import { useMemo } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { useMobilePlayer } from "@/components/mobile/mobile-now-playing-sheet";

type Props = {
  /** Called when the user taps the artwork / title area to open the full Now Playing sheet. */
  onOpen: () => void;
};

/**
 * Persistent mini player that sits above the bottom nav on every mobile tab.
 *
 * Core-control contract (see Commit B requirement): transport buttons —
 * previous, play/pause, next — are ALWAYS rendered here. They disable
 * visually (opacity + aria) when there is nothing to control, but are never
 * hidden behind menus or extra taps. Volume is kept off the mini-player to
 * keep it compact; it lives in the full Now Playing sheet with an explicit
 * mode label (MASTER volume vs. this phone volume).
 *
 * Tap rules:
 *   - tapping the artwork / title block opens the Now Playing sheet
 *   - tapping any transport button does NOT open the sheet (event stops)
 */
export function MobileMiniPlayer({ onOpen }: Props) {
  const d = useMobilePlayer();

  const playBg = d.isPlaying
    ? d.accent === "sky"
      ? "bg-sky-500 text-slate-950"
      : "bg-emerald-500 text-slate-950"
    : "bg-slate-100 text-slate-950";

  const progressPct = useMemo(() => {
    if (!d.duration || d.duration <= 0) return 0;
    return Math.max(0, Math.min(100, (d.position / d.duration) * 100));
  }, [d.position, d.duration]);

  const progressBar = d.accent === "sky" ? "bg-sky-400" : "bg-emerald-400";

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
          className={`h-full transition-[width] duration-200 ${progressBar}`}
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
              d.hasSource && d.isPlaying ? "shadow-[0_0_0_1px_rgba(56,189,248,0.35)]" : ""
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
                d.hasSource
                  ? "text-slate-100"
                  : d.accent === "sky"
                    ? "text-sky-300"
                    : "text-emerald-300"
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

        {/* Transport cluster — always visible, disabled (not hidden) when idle. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onPrev();
            }}
            disabled={!d.canControl}
            aria-label="Previous"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:text-slate-100 disabled:opacity-40"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 6v12h2V6H7zm3 6l8 6V6l-8 6z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onPlayPause();
            }}
            disabled={!d.canControl}
            aria-label={d.isPlaying ? "Pause" : "Play"}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 ${playBg}`}
          >
            {d.isPlaying ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="ml-0.5 h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onNext();
            }}
            disabled={!d.canControl}
            aria-label="Next"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:text-slate-100 disabled:opacity-40"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 18l8-6-8-6v12zm9-12v12h2V6h-2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
