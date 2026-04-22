"use client";

import { useEffect, useMemo } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { useMobileRole } from "@/lib/mobile-role-context";
import { useStationController } from "@/lib/station-controller-context";
import { usePlayback } from "@/lib/playback-provider";
import { useLocalPlaybackTime } from "@/lib/playback-time-store";
import {
  PlaybackTransportIconNext,
  PlaybackTransportIconPause,
  PlaybackTransportIconPlay,
  PlaybackTransportIconPrev,
  PlaybackTransportIconStop,
  PlaybackTransportIconVolume,
} from "@/components/player-surface/playback-transport-icons";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Derived = {
  mode: "controller" | "player";
  /** True iff the mode actually has something to control. Controller needs a connected MASTER. */
  canControl: boolean;
  hasSource: boolean;
  isPlaying: boolean;
  title: string;
  subtitle: string | null;
  cover: string | null;
  position: number;
  duration: number;
  volume: number;
  onPlayPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (value: number) => void;
};

/**
 * Shared derivation used by both the mini-player and the Now Playing sheet.
 *
 * Visual language rule (mobile+remote alignment pass): Controller mode and
 * Player mode share ONE SyncBiz visual language — slate chrome with emerald
 * accents that match `playback-dock-surface.css`. The mode is communicated
 * through the mode pill and the volume label, never through different accent
 * colors.
 */
function useDerivedPlayer(): Derived {
  const { mobileRole } = useMobileRole();
  const station = useStationController();
  const playback = usePlayback();
  const localTime = useLocalPlaybackTime();

  if (mobileRole === "controller") {
    const rs = station.remoteState;
    const canControl = station.isCrossDevice;
    const src = rs?.currentSource ?? null;
    const trk = rs?.currentTrack ?? null;
    const status = rs?.status ?? "idle";
    const isPlaying = canControl && status === "playing";
    return {
      mode: "controller",
      canControl,
      hasSource: canControl && !!src,
      isPlaying,
      title: canControl ? trk?.title ?? src?.title ?? "No playback" : "Connect a player",
      subtitle:
        canControl && src?.title && trk?.title !== src.title
          ? src.title
          : canControl
            ? null
            : "Go to the Remote tab to pick a MASTER device",
      cover: canControl ? trk?.cover ?? src?.cover ?? null : null,
      position: rs?.position ?? 0,
      duration: rs?.duration ?? 0,
      volume: typeof rs?.volume === "number" ? rs.volume : 80,
      onPlayPause: () => {
        if (!canControl) return;
        if (isPlaying) station.sendPause();
        else station.sendPlay();
      },
      onStop: () => {
        if (canControl) station.sendStop();
      },
      onNext: () => {
        if (canControl) station.sendNext();
      },
      onPrev: () => {
        if (canControl) station.sendPrev();
      },
      onSeek: (seconds: number) => {
        if (canControl) station.sendSeek(seconds);
      },
      onVolume: (value: number) => {
        if (canControl) station.sendSetVolume(value);
      },
    };
  }

  const src = playback.currentSource;
  const trk = playback.currentTrack;
  const isPlaying = playback.status === "playing";
  return {
    mode: "player",
    canControl: true,
    hasSource: !!src,
    isPlaying,
    title: trk?.title ?? src?.title ?? "Nothing playing",
    subtitle: src?.title && trk?.title !== src.title ? src.title : null,
    cover: trk?.cover ?? src?.cover ?? null,
    position: localTime.position,
    duration: localTime.duration,
    volume: playback.volume,
    onPlayPause: () => {
      if (!src) return;
      if (isPlaying) playback.pause();
      else playback.play();
    },
    onStop: () => {
      if (src) playback.stop();
    },
    onNext: () => {
      if (src) playback.next();
    },
    onPrev: () => {
      if (src) playback.prev();
    },
    onSeek: (seconds: number) => {
      if (src) playback.seekTo(seconds);
    },
    onVolume: (value: number) => {
      playback.setVolume(value);
    },
  };
}

/** Shared with `MobileMiniPlayer` so both surfaces drive state identically. */
export function useMobilePlayer() {
  return useDerivedPlayer();
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Visual tokens — mirror `playback-dock-surface.css` so mobile reads as a
// direct extension of the desktop SyncBiz player. Kept as constants rather
// than utility classes to keep the button bodies compact below.
const SECONDARY_BTN =
  "flex shrink-0 items-center justify-center rounded-xl border border-slate-700/80 bg-gradient-to-b from-slate-700/20 to-slate-900/95 text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_2px_6px_rgba(0,0,0,0.4)] transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400/40";

const PRIMARY_BTN =
  "flex shrink-0 items-center justify-center rounded-xl border border-emerald-500/50 bg-gradient-to-b from-emerald-400/35 to-emerald-600/25 text-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_16px_rgba(0,0,0,0.4),0_0_32px_rgba(30,215,96,0.25)] transition hover:border-emerald-400/70 hover:text-white disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400/40";

/**
 * Full-screen bottom sheet shown when the user taps the mini-player.
 *
 * Design contract (same as Commit B + alignment pass):
 *   - transport buttons (prev / stop / play-pause / next) are ALWAYS rendered;
 *     they disable via opacity + pointer-events when `canControl` / `hasSource`
 *     is false — never hidden.
 *   - volume slider is ALWAYS rendered with a mode-specific label:
 *       Controller → "MASTER · desktop volume"
 *       Player     → "This phone · local player volume"
 *   - visual language matches `playback-dock-surface` (slate chrome, emerald
 *     play glow, rounded-xl buttons, rounded-full volume track).
 *   - closes via: X button, backdrop tap, or ESC key. No swipe gestures yet.
 */
export function MobileNowPlayingSheet({ open, onClose }: Props) {
  const d = useDerivedPlayer();

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

  const progressPct = useMemo(() => {
    if (!d.duration || d.duration <= 0) return 0;
    return Math.max(0, Math.min(100, (d.position / d.duration) * 100));
  }, [d.position, d.duration]);

  const volumeLabel =
    d.mode === "controller"
      ? "MASTER · desktop volume"
      : "This phone · local player volume";

  const transportDisabled = !d.canControl || !d.hasSource;

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
          <div className="mx-auto mt-6 aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl bg-slate-800/80 shadow-[0_20px_60px_rgba(0,0,0,0.45)] ring-1 ring-slate-700/60">
            {d.cover ? (
              <HydrationSafeImage src={d.cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-600">
                <svg className="h-20 w-20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </div>

          <div className="mt-6 text-center">
            <p className={`text-xl font-semibold tracking-tight ${d.hasSource ? "text-slate-50" : "text-slate-400"}`}>
              {d.title}
            </p>
            {d.subtitle && (
              <p className="mt-1 line-clamp-2 text-sm text-slate-400">{d.subtitle}</p>
            )}
          </div>

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
              className="h-2 w-full appearance-none rounded-full bg-slate-700/80 accent-emerald-500 disabled:opacity-40"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-slate-400">
              <span>{formatTime(d.position)}</span>
              <div className="flex-1 px-2">
                <div className="mx-auto h-[2px] w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
              <span>{d.duration > 0 ? formatTime(d.duration) : "--:--"}</span>
            </div>
          </div>

          {/* Transport — desktop parity: Prev · Stop · Play/Pause · Next */}
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={d.onPrev}
              disabled={transportDisabled}
              aria-label="Previous"
              className={`${SECONDARY_BTN} h-12 w-12 active:scale-95`}
            >
              <PlaybackTransportIconPrev className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={d.onStop}
              disabled={transportDisabled}
              aria-label="Stop"
              className={`${SECONDARY_BTN} h-12 w-12 active:scale-95`}
            >
              <PlaybackTransportIconStop className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={d.onPlayPause}
              disabled={!d.canControl || !d.hasSource}
              aria-label={d.isPlaying ? "Pause" : "Play"}
              className={`${PRIMARY_BTN} h-16 w-16 active:scale-95`}
            >
              {d.isPlaying ? (
                <PlaybackTransportIconPause className="h-8 w-8" />
              ) : (
                <PlaybackTransportIconPlay className="ml-0.5 h-8 w-8" />
              )}
            </button>
            <button
              type="button"
              onClick={d.onNext}
              disabled={transportDisabled}
              aria-label="Next"
              className={`${SECONDARY_BTN} h-12 w-12 active:scale-95`}
            >
              <PlaybackTransportIconNext className="h-6 w-6" />
            </button>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-700/60 bg-slate-900/60 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-300">
                {volumeLabel}
              </span>
              <span className="text-[11px] font-semibold tabular-nums text-slate-300">
                {Math.round(d.volume)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <PlaybackTransportIconVolume className="h-5 w-5 shrink-0 text-slate-400" />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={d.volume}
                onChange={(e) => d.onVolume(Number(e.target.value))}
                disabled={!d.canControl}
                aria-label={volumeLabel}
                className="h-2 flex-1 appearance-none rounded-full bg-slate-700/80 accent-emerald-500 disabled:opacity-40"
              />
            </div>
          </div>

          {!d.canControl && d.mode === "controller" && (
            <p className="mt-4 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-center text-xs text-slate-400">
              No MASTER player connected. Controls are disabled until a device
              joins the station.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
