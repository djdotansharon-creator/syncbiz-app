"use client";

import { useEffect } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import {
  primeIOSFromGesture,
  setIOSNeedsTapToResume,
  useIOSNeedsTapToResume,
} from "@/lib/ios-audio-unlock";
import { PlaybackTransportIconVolume } from "@/components/player-surface/playback-transport-icons";
import { useMobilePlayer } from "@/components/mobile/mobile-player-core";
import { MobileTransportControls } from "@/components/mobile/mobile-transport-controls";

// Re-export so existing importers (mini-player) keep a stable path.
export { useMobilePlayer } from "@/components/mobile/mobile-player-core";

type Props = {
  open: boolean;
  onClose: () => void;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Full-screen bottom sheet shown when the user taps the mini-player.
 *
 * Contract:
 *   - transport (prev · stop · play/pause · next) + mode toggles (random · mix)
 *     come from the shared `MobileTransportControls`; identical actions/state to
 *     the main SyncBiz player. Disabled (not hidden) when there is nothing to
 *     control.
 *   - volume slider is ALWAYS rendered with a mode-specific label.
 *   - visual language matches the main player's deck: cyan-400 stroke, dark
 *     slate fill, cyan glow; Play is a wider stadium pill; sliders are
 *     cyan-accented; artwork is circular with a cyan ring.
 *   - closes via: X button, backdrop tap, or ESC key. No swipe gestures.
 */
export function MobileNowPlayingSheet({ open, onClose }: Props) {
  const d = useMobilePlayer();
  const needsTapToResume = useIOSNeedsTapToResume() && d.mode === "player";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const volumeLabel =
    d.mode === "controller"
      ? "MASTER · desktop volume"
      : "This phone · local player volume";

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-200 ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close Now Playing"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Now Playing"
        className={`absolute inset-x-0 bottom-0 top-8 flex flex-col rounded-t-3xl border-t border-slate-700/60 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 shadow-[0_-20px_60px_rgba(0,0,0,0.6)] transition-transform duration-250 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {needsTapToResume && (
          <button
            type="button"
            onClick={() => {
              // Synchronous prime + clear flag inside the gesture so iOS
              // re-arms the audio element before AudioPlayer's effect runs.
              primeIOSFromGesture();
              setIOSNeedsTapToResume(false);
              d.onPlayPause();
            }}
            className="mx-3 mt-3 flex items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2.5 text-sm font-semibold text-amber-100 shadow-[0_0_24px_-6px_rgba(251,191,36,0.45)] transition active:scale-[0.99]"
            aria-live="polite"
          >
            <span aria-hidden>⚠</span>
            <span>Safari blocked audio — tap to resume</span>
          </button>
        )}

        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="rounded-full border border-slate-700/70 bg-slate-900/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200">
            {d.mode === "controller" ? "Controller" : "Player"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800/70 text-slate-200 transition hover:bg-slate-700/80 active:scale-95"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6">
          {/* Artwork — circular with cyan ring when playing, matching the main
              SyncBiz player's `.library-deck-art-host` on `/sources`. */}
          <div
            className={`mx-auto mt-2 aspect-square w-full max-w-[220px] overflow-hidden rounded-full bg-slate-800/80 shadow-[0_10px_20px_-6px_rgba(0,0,0,0.5)] ${
              d.hasSource && d.isPlaying
                ? "ring-2 ring-cyan-400/70 shadow-[0_0_32px_-6px_rgba(34,211,238,0.45)]"
                : "ring-2 ring-slate-700/70"
            }`}
          >
            {d.cover ? (
              <HydrationSafeImage src={d.cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-600">
                <svg className="h-16 w-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
          </div>

          <div className="mt-5 text-center">
            <p className={`truncate text-xl font-semibold tracking-tight ${d.hasSource ? "text-slate-50" : "text-slate-400"}`}>
              {d.title}
            </p>
            {d.subtitle && (
              <p className="mt-1 line-clamp-2 text-xs uppercase tracking-wide text-slate-500">
                {d.subtitle}
              </p>
            )}
          </div>

          {/* Transport + mode toggles — shared with the mini-player. */}
          <div className="mt-7">
            <MobileTransportControls d={d} variant="sheet" />
          </div>

          {/* Seek — slim row under the transport so it reads as detail, not a primary control. */}
          <div className="mt-6">
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(d.duration))}
              step={1}
              value={Math.max(0, Math.min(d.duration, d.position))}
              onChange={(e) => d.onSeek(Number(e.target.value))}
              disabled={!d.hasSource || d.duration <= 0}
              aria-label="Seek"
              aria-valuenow={Math.floor(d.position)}
              aria-valuemin={0}
              aria-valuemax={Math.max(1, Math.floor(d.duration))}
              className="syncbiz-mobile-range"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-slate-500">
              <span>{formatTime(d.position)}</span>
              <span>{d.duration > 0 ? formatTime(d.duration) : "--:--"}</span>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {volumeLabel}
              </span>
              <span className="text-[11px] font-semibold tabular-nums text-slate-500">
                {Math.round(d.volume)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <PlaybackTransportIconVolume className="h-4 w-4 shrink-0 text-cyan-400/80" />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={d.volume}
                onChange={(e) => d.onVolume(Number(e.target.value))}
                disabled={!d.canControl}
                aria-label={volumeLabel}
                className="syncbiz-mobile-range syncbiz-mobile-range--slim flex-1"
              />
            </div>
          </div>

          {!d.canControl && d.mode === "controller" && (
            <p className="mt-5 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-center text-xs text-slate-400">
              No MASTER player connected. Controls are disabled until a device
              joins the station.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
