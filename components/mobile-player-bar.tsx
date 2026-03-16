"use client";

import { useCallback, useRef, useState } from "react";
import { useStationController } from "@/lib/station-controller-context";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = h > 0 ? m % 60 : m;
  const ss = s % 60;
  if (h > 0) return `${h}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

/**
 * Mobile player = responsive compact version of the same SyncBiz player.
 * Same button shape, glow, border, hierarchy, order, spacing logic.
 * Same dark neon hardware-inspired feel. Same player system identity.
 */
export function MobilePlayerBar() {
  const station = useStationController();
  const progressRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isControllerMode = station.isCrossDevice;
  const rs = station.remoteState;

  const displayTitle = isControllerMode
    ? (rs?.currentTrack?.title ?? rs?.currentSource?.title ?? "No playback")
    : "Connect to a player";
  const displaySubtitle = isControllerMode
    ? (rs?.currentSource?.title && rs?.currentTrack?.title !== rs?.currentSource?.title ? rs.currentSource.title : null)
    : "Select a device above";
  const thumbnail = isControllerMode ? (rs?.currentTrack?.cover ?? rs?.currentSource?.cover ?? null) : null;
  const status = isControllerMode ? (rs?.status ?? "idle") : "idle";
  const isPlaying = status === "playing";
  const hasSource = isControllerMode && !!rs?.currentSource;
  const position = typeof rs?.position === "number" && Number.isFinite(rs.position) ? rs.position : 0;
  const duration = typeof rs?.duration === "number" && Number.isFinite(rs.duration) ? rs.duration : 0;
  const volume = typeof rs?.volume === "number" && Number.isFinite(rs.volume) ? rs.volume : 80;
  const progressPercent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const canSeek = duration > 0;

  const handlePlayPause = () => {
    if (isControllerMode) {
      if (isPlaying) station.sendPause();
      else station.sendPlay();
    }
  };

  const handlePrev = () => isControllerMode && station.sendPrev();
  const handleNext = () => isControllerMode && station.sendNext();
  const handleStop = () => isControllerMode && station.sendStop();

  const getPercentFromTouch = useCallback((clientX: number): number => {
    const el = progressRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(100, (x / rect.width) * 100));
  }, []);

  const handleSeek = useCallback(
    (percent: number) => {
      if (!canSeek || duration <= 0) return;
      station.sendSeek((percent / 100) * duration);
    },
    [canSeek, duration, station.sendSeek]
  );

  const handleProgressTouchStart = (e: React.TouchEvent) => {
    if (!canSeek) return;
    setIsDragging(true);
    const touch = e.touches[0];
    if (touch) handleSeek(getPercentFromTouch(touch.clientX));
  };

  const handleProgressTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || !canSeek) return;
    const touch = e.touches[0];
    if (touch) handleSeek(getPercentFromTouch(touch.clientX));
  };

  const handleProgressTouchEnd = () => setIsDragging(false);

  const handleProgressClick = (e: React.MouseEvent) => {
    if (!canSeek) return;
    handleSeek(getPercentFromTouch(e.clientX));
  };

  return (
    <div
      className="flex flex-col gap-3 border-b border-slate-800/80 bg-slate-950/98 px-4 py-4 shadow-[0_4px_24px_rgba(0,0,0,0.4),0_0_0_1px_rgba(30,215,96,0.08)]"
      role="region"
      aria-label="Player controller"
    >
      {/* Artwork + Track panel – same structure as desktop, compact */}
      <div className="flex min-w-0 items-center gap-3">
        {/* Circular artwork – same ring treatment as desktop */}
        <div className="relative flex shrink-0 items-center justify-center">
          <div
            className={`relative flex shrink-0 items-center justify-center rounded-full border-2 p-[5px] bg-slate-800/80 ${
              isPlaying
                ? "playing-active-ring"
                : "border-slate-600/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(0,0,0,0.2),0_2px_12px_rgba(0,0,0,0.3)]"
            }`}
          >
            <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-slate-800/90 shadow-[inset_0_0_8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
              {thumbnail ? (
                <HydrationSafeImage src={thumbnail} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                  <svg className="h-7 w-7 text-slate-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Track display – compact version of desktop panel */}
        <div className="relative flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-slate-700/60 bg-slate-900/40 py-2 pl-3 pr-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_1px_3px_rgba(0,0,0,0.2)] ring-1 ring-slate-700/40">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[7px] font-semibold uppercase tracking-wider ${
                isPlaying
                  ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40"
                  : status === "paused"
                    ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40"
                    : "bg-slate-800/80 text-slate-500 ring-1 ring-slate-600/30"
              }`}
            >
              <span
                className={`h-1 w-1 shrink-0 rounded-full ${isPlaying ? "bg-emerald-400 playing-led-pulse" : status === "paused" ? "bg-amber-400" : "bg-slate-500"}`}
              />
              {status}
            </span>
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-slate-100" title={displayTitle}>
              {displayTitle}
            </p>
          </div>
          {displaySubtitle && (
            <p className="truncate text-[10px] font-medium text-slate-400">{displaySubtitle}</p>
          )}
        </div>
      </div>

      {/* Transport – same order and NeonControlButton as desktop: Prev | Stop | Play/Pause | Next */}
      <div className="flex items-center justify-center gap-2 sm:gap-3">
        <NeonControlButton
          size="md"
          onClick={handlePrev}
          disabled={!isControllerMode || !hasSource}
          aria-label="Previous"
          title="Previous"
          className="!h-12 !w-12 touch-manipulation"
        >
          <svg className="h-5 w-5 scale-x-[-1]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18V6h2v12H6zm11-6l-7 6V6l7 6z" />
          </svg>
        </NeonControlButton>
        <NeonControlButton
          size="md"
          onClick={handleStop}
          disabled={!isControllerMode || !hasSource}
          aria-label="Stop"
          title="Stop"
          className="!h-12 !w-12 touch-manipulation"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h12v12H6z" />
          </svg>
        </NeonControlButton>
        <NeonControlButton
          size="xl"
          onClick={handlePlayPause}
          disabled={!isControllerMode || (!hasSource && status === "idle")}
          active={isPlaying}
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
          className="!h-14 !min-w-[100px] !w-auto !px-5 !rounded-2xl touch-manipulation"
        >
          <span className="relative flex h-8 w-8 items-center justify-center" aria-hidden>
            <svg
              className={`absolute ${isPlaying ? "opacity-100" : "pointer-events-none opacity-0"}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
            <svg
              className={`absolute ml-0.5 ${isPlaying ? "pointer-events-none opacity-0" : "opacity-100"}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </span>
        </NeonControlButton>
        <NeonControlButton
          size="md"
          onClick={handleNext}
          disabled={!isControllerMode || !hasSource}
          aria-label="Next"
          title="Next"
          className="!h-12 !w-12 touch-manipulation"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18V6h2v12H6zm11-6l-7 6V6l7 6z" />
          </svg>
        </NeonControlButton>
      </div>

      {/* Progress / Seek – same as desktop: time | bar | time, green fill, green thumb */}
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-400" aria-live="polite">
          {formatTime(position)}
        </span>
        <div
          ref={progressRef}
          role="slider"
          aria-label="Track progress"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={position}
          aria-disabled={!canSeek}
          tabIndex={canSeek ? 0 : undefined}
          className={`relative flex flex-1 min-w-0 select-none py-2 ${canSeek ? "cursor-pointer touch-manipulation" : "cursor-default opacity-80"}`}
          onTouchStart={handleProgressTouchStart}
          onTouchMove={handleProgressTouchMove}
          onTouchEnd={handleProgressTouchEnd}
          onTouchCancel={handleProgressTouchEnd}
          onClick={handleProgressClick}
        >
          {/* Track background – same h-2 as desktop */}
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-slate-700/80" />
          {/* Played layer – same green as desktop */}
          <div
            className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#1ed760] shadow-[0_0_6px_rgba(30,215,96,0.4)] transition-all duration-100"
            style={{ width: `${progressPercent}%` }}
          />
          {/* Thumb – same as desktop */}
          {canSeek && (
            <div
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1ed760] shadow-[0_0_0_2px_rgba(30,215,96,0.3),0_0_8px_var(--neon-green-glow)] transition-all duration-100"
              style={{ left: `${Math.max(0, Math.min(100, progressPercent))}%` }}
            />
          )}
        </div>
        <span className="w-10 shrink-0 text-left text-xs font-semibold tabular-nums text-slate-400" aria-live="polite">
          {formatTime(duration)}
        </span>
      </div>

      {/* Volume – same structure as desktop: mute + slider + value, cyan border */}
      {isControllerMode && (
        <div className="flex min-w-[52px] shrink items-center gap-1 rounded-lg border border-cyan-500/50 bg-slate-900/80 px-2 py-1.5 sm:min-w-[70px] sm:gap-1.5 sm:px-2.5">
          <button
            type="button"
            onClick={() => station.sendSetVolume(volume > 0 ? 0 : 80)}
            className="flex h-9 w-9 shrink-0 items-center justify-center text-cyan-500 transition-colors hover:text-cyan-400 touch-manipulation"
            aria-label={volume === 0 ? "Unmute" : "Mute"}
            title={volume === 0 ? "Unmute" : "Mute"}
          >
            {volume === 0 ? (
              <svg className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
              </svg>
            )}
          </button>
          <div className="relative flex flex-1 min-w-0 items-center py-2">
            <div className="absolute inset-x-0 top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-slate-700/80" aria-hidden />
            <div
              className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-cyan-500 transition-all duration-100"
              style={{ width: `${volume}%` }}
              aria-hidden
            />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => station.sendSetVolume(Number(e.target.value))}
              className="player-volume-slider relative z-10 h-[3px] w-full cursor-pointer touch-manipulation"
              aria-label="Volume"
            />
          </div>
          <span className="w-6 shrink-0 text-end text-[10px] font-bold tabular-nums text-cyan-500 sm:w-8 sm:text-xs">
            {volume}
          </span>
        </div>
      )}
    </div>
  );
}
