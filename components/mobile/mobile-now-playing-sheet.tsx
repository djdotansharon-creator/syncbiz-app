"use client";

import { useEffect, useMemo } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { useMobileRole } from "@/lib/mobile-role-context";
import { useStationController } from "@/lib/station-controller-context";
import { usePlayback } from "@/lib/playback-provider";
import { useLocalPlaybackTime } from "@/lib/playback-time-store";

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
  accent: "sky" | "emerald";
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (value: number) => void;
};

/**
 * Shared derivation used by both the mini-player and the Now Playing sheet.
 *
 * Design rule (see user requirement for Commit B): transport + volume must be
 * ALWAYS accessible. The hook therefore always returns a non-throwing
 * handler for every action; the UI layer uses `canControl` / `hasSource` to
 * disable buttons visually, never to hide them.
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
      accent: "sky",
      onPlayPause: () => {
        if (!canControl) return;
        if (isPlaying) station.sendPause();
        else station.sendPlay();
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
    accent: "emerald",
    onPlayPause: () => {
      if (!src) return;
      if (isPlaying) playback.pause();
      else playback.play();
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

/**
 * Full-screen bottom sheet shown when the user taps the mini-player.
 *
 * Design contract for Commit B:
 *   - transport buttons (prev / play-pause / next) are ALWAYS rendered; they
 *     disable themselves via opacity + pointer-events when `canControl` is
 *     false (e.g. controller mode without a connected MASTER) — never hidden.
 *   - volume slider is ALWAYS rendered with a mode-specific label:
 *       Controller → "MASTER · desktop volume"
 *       Player     → "This phone · local player volume"
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
    // Lock background scroll while the sheet is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const accentBg = d.accent === "sky" ? "bg-sky-500" : "bg-emerald-500";
  const accentText = d.accent === "sky" ? "text-sky-300" : "text-emerald-300";
  const accentRing = d.accent === "sky" ? "ring-sky-500/40" : "ring-emerald-500/40";

  const progressPct = useMemo(() => {
    if (!d.duration || d.duration <= 0) return 0;
    return Math.max(0, Math.min(100, (d.position / d.duration) * 100));
  }, [d.position, d.duration]);

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
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
              d.mode === "controller"
                ? "bg-sky-500/15 text-sky-200 ring-sky-500/40"
                : "bg-amber-500/15 text-amber-200 ring-amber-500/40"
            }`}
          >
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
            <p className={`text-xl font-semibold tracking-tight ${d.hasSource ? "text-slate-50" : accentText}`}>
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
              className={`w-full accent-current ${accentText} disabled:opacity-40`}
            />
            <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-slate-400">
              <span>{formatTime(d.position)}</span>
              <div className="flex-1 px-2">
                <div className="mx-auto h-[2px] w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full ${accentBg}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
              <span>{d.duration > 0 ? formatTime(d.duration) : "--:--"}</span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-6">
            <TransportButton
              label="Previous"
              onClick={d.onPrev}
              disabled={!d.canControl}
              size="md"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-6 w-6">
                <path d="M7 6v12h2V6H7zm3 6l8 6V6l-8 6z" />
              </svg>
            </TransportButton>
            <button
              type="button"
              onClick={d.onPlayPause}
              disabled={!d.canControl}
              aria-label={d.isPlaying ? "Pause" : "Play"}
              className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-2 ${accentRing} ${accentBg} text-slate-950 shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition active:scale-95 disabled:opacity-40`}
            >
              {d.isPlaying ? (
                <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg className="ml-1 h-7 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <TransportButton label="Next" onClick={d.onNext} disabled={!d.canControl} size="md">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-6 w-6">
                <path d="M6 18l8-6-8-6v12zm9-12v12h2V6h-2z" />
              </svg>
            </TransportButton>
          </div>

          <div className="mt-8">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                {volumeLabel}
              </span>
              <span className="text-[11px] tabular-nums text-slate-500">
                {Math.round(d.volume)}%
              </span>
            </div>
            <div className="flex items-center gap-3">
              <VolumeIcon level={d.volume} />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={d.volume}
                onChange={(e) => d.onVolume(Number(e.target.value))}
                disabled={!d.canControl}
                aria-label={volumeLabel}
                className={`flex-1 accent-current ${accentText} disabled:opacity-40`}
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

function TransportButton({
  children,
  label,
  onClick,
  disabled,
  size,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  size: "sm" | "md";
}) {
  const dim = size === "md" ? "h-12 w-12" : "h-10 w-10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full text-slate-200 transition hover:text-white active:scale-95 disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function VolumeIcon({ level }: { level: number }) {
  // Three distinct icons — muted (0), low (<=50), high (>50). No copy of
  // Spotify glyphs; these are plain speaker+wave primitives.
  const muted = level <= 0;
  const low = !muted && level <= 50;
  return (
    <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 10v4h3l5 4V6l-5 4H4z" fill="currentColor" stroke="none" />
      {!muted && (
        <>
          <path d="M16 9c1.2 1.2 1.2 4.8 0 6" strokeLinecap="round" />
          {!low && <path d="M18.5 6.5c2.5 2.5 2.5 8.5 0 11" strokeLinecap="round" />}
        </>
      )}
      {muted && <path d="M17 10l5 4m0-4l-5 4" strokeLinecap="round" />}
    </svg>
  );
}
