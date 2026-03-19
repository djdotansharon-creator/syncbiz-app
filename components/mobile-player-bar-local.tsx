"use client";

import { usePlayback } from "@/lib/playback-provider";
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
 * Mobile player bar for Player mode – uses local PlaybackProvider.
 * Does NOT send commands to desktop. Plays on the phone.
 */
export function MobilePlayerBarLocal() {
  const { currentTrack, currentSource, status, volume, setVolume, play, pause, stop, next, prev } = usePlayback();

  const isPlaying = status === "playing";
  const hasSource = !!currentSource;
  const position = 0;
  const duration = 0;
  const progressPercent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  const displayTitle = currentTrack?.title ?? currentSource?.title ?? "No playback";
  const displaySubtitle = currentSource?.title && currentTrack?.title !== currentSource?.title ? currentSource.title : null;
  const thumbnail = currentTrack?.cover ?? currentSource?.cover ?? null;

  return (
    <div
      className="flex flex-col gap-3 px-4 py-4 ring-1 ring-emerald-500/10 ring-inset"
      role="region"
      aria-label="Now playing"
    >
      <div className="flex min-w-0 items-center gap-3">
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

      <div className="flex items-center justify-center gap-2 sm:gap-3">
        <NeonControlButton
          size="md"
          onClick={prev}
          disabled={!hasSource}
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
          onClick={stop}
          disabled={!hasSource}
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
          onClick={isPlaying ? pause : play}
          disabled={!hasSource && status === "idle"}
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
          onClick={next}
          disabled={!hasSource}
          aria-label="Next"
          title="Next"
          className="!h-12 !w-12 touch-manipulation"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18V6h2v12H6zm11-6l-7 6V6l7 6z" />
          </svg>
        </NeonControlButton>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-400">
          {formatTime(position)}
        </span>
        <div className="relative flex flex-1 min-w-0 py-2">
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-slate-700/80" />
          <div
            className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#1ed760] shadow-[0_0_6px_rgba(30,215,96,0.4)] transition-all duration-100"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="w-10 shrink-0 text-left text-xs font-semibold tabular-nums text-slate-400">
          {formatTime(duration)}
        </span>
      </div>

      <div className="flex min-w-[52px] shrink items-center gap-1 rounded-lg border border-cyan-500/50 bg-slate-900/80 px-2 py-1.5 sm:min-w-[70px] sm:gap-1.5 sm:px-2.5">
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
            onChange={(e) => setVolume(Number(e.target.value))}
            className="player-volume-slider relative z-10 h-[3px] w-full cursor-pointer touch-manipulation"
            aria-label="Volume"
          />
        </div>
        <span className="w-6 shrink-0 text-end text-[10px] font-bold tabular-nums text-cyan-500 sm:w-8 sm:text-xs">
          {volume}
        </span>
      </div>
    </div>
  );
}
