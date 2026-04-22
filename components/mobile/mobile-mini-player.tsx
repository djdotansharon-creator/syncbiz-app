"use client";

import { useMobileRole } from "@/lib/mobile-role-context";
import { useStationController } from "@/lib/station-controller-context";
import { usePlayback } from "@/lib/playback-provider";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";

type Derived = {
  hasSource: boolean;
  isPlaying: boolean;
  title: string;
  subtitle: string | null;
  cover: string | null;
  accent: "sky" | "emerald";
  onPlayPause: () => void;
  onNext: () => void;
};

function useDerivedPlayerState(): Derived {
  const { mobileRole } = useMobileRole();
  const station = useStationController();
  const playback = usePlayback();

  if (mobileRole === "controller") {
    const rs = station.remoteState;
    const isCross = station.isCrossDevice;
    const src = rs?.currentSource ?? null;
    const trk = rs?.currentTrack ?? null;
    const status = rs?.status ?? "idle";
    const isPlaying = isCross && status === "playing";
    return {
      hasSource: isCross && !!src,
      isPlaying,
      title: isCross ? (trk?.title ?? src?.title ?? "No playback") : "Connect a player",
      subtitle: isCross
        ? src?.title && trk?.title !== src.title
          ? src.title
          : null
        : "Go to Remote tab",
      cover: isCross ? (trk?.cover ?? src?.cover ?? null) : null,
      accent: "sky",
      onPlayPause: () => {
        if (!isCross) return;
        if (isPlaying) station.sendPause();
        else station.sendPlay();
      },
      onNext: () => {
        if (isCross) station.sendNext();
      },
    };
  }

  const src = playback.currentSource;
  const trk = playback.currentTrack;
  const isPlaying = playback.status === "playing";
  return {
    hasSource: !!src,
    isPlaying,
    title: trk?.title ?? src?.title ?? "Nothing playing",
    subtitle: src?.title && trk?.title !== src.title ? src.title : null,
    cover: trk?.cover ?? src?.cover ?? null,
    accent: "emerald",
    onPlayPause: () => {
      if (isPlaying) playback.pause();
      else playback.play();
    },
    onNext: () => playback.next(),
  };
}

/**
 * Persistent mini player that sits above the bottom nav on every mobile tab.
 * Height: 64px. Tap the artwork+text area to open the Now Playing sheet (wired in Commit 3).
 * Controller mode reflects the remote station state; Player mode reflects local playback.
 */
export function MobileMiniPlayer() {
  const {
    hasSource,
    isPlaying,
    title,
    subtitle,
    cover,
    accent,
    onPlayPause,
    onNext,
  } = useDerivedPlayerState();

  const accentClass =
    accent === "sky"
      ? "text-sky-300"
      : "text-emerald-300";

  return (
    <div
      className="flex items-center gap-3 border-t border-slate-800/80 bg-slate-950/96 px-3 py-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur"
      role="region"
      aria-label="Mini player"
    >
      <div
        className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-slate-800 ring-1 ring-slate-700/60 ${hasSource && isPlaying ? "shadow-[0_0_0_1px_rgba(56,189,248,0.35)]" : ""}`}
        aria-hidden
      >
        {cover ? (
          <HydrationSafeImage src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg className="h-5 w-5 text-slate-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className={`truncate text-[13px] font-semibold leading-tight ${hasSource ? "text-slate-100" : accentClass}`}>
          {title}
        </p>
        {subtitle && (
          <p className="truncate text-[11px] font-medium leading-tight text-slate-400">{subtitle}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!hasSource}
        aria-label="Next"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:text-slate-100 disabled:opacity-40"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M6 18V6h2v12H6zm11-6l-7 6V6l7 6z" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onPlayPause}
        disabled={!hasSource}
        aria-label={isPlaying ? "Pause" : "Play"}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 ${
          isPlaying
            ? accent === "sky"
              ? "bg-sky-500 text-slate-950"
              : "bg-emerald-500 text-slate-950"
            : "bg-slate-100 text-slate-950"
        }`}
      >
        {isPlaying ? (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg className="ml-0.5 h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}
