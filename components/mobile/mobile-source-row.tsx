"use client";

import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { MobileSourceCardActions } from "@/components/mobile-source-card-actions";
import { useMobileRole } from "@/lib/mobile-role-context";
import { useStationController } from "@/lib/station-controller-context";
import { usePlayback } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";

type Props = {
  source: UnifiedSource;
  onRemove?: (id: string, origin?: UnifiedSource["origin"]) => void;
  editReturnTo?: string;
  /** When true, render a tighter variant (used in Home/Search grids). */
  compact?: boolean;
};

/**
 * Unified mobile list row – the single replacement for the legacy
 * MobileSourceCard / MobileSourceCardLocal pair. Tapping the play area:
 *   - mobileRole === "controller" → sends PLAY_SOURCE via the station controller WS
 *   - mobileRole === "player"     → starts local playback via PlaybackProvider
 *
 * The overflow menu (edit / share / delete) is identical in both modes.
 */
export function MobileSourceRow({ source, onRemove, editReturnTo, compact = false }: Props) {
  const { mobileRole } = useMobileRole();
  const station = useStationController();
  const { playSource, currentSource, status } = usePlayback();

  const isController = mobileRole === "controller";
  const remoteActive = isController && station.remoteState?.currentSource?.id === source.id;
  const localActive = !isController && currentSource?.id === source.id && status !== "idle";
  const active = remoteActive || localActive;

  const canController = isController ? station.isCrossDevice : true;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isController) {
      if (station.isCrossDevice) station.sendPlaySource(source);
      return;
    }
    playSource(source);
  };

  const metaLine = (() => {
    if (source.origin === "playlist") {
      const count = source.playlist?.tracks?.length ?? 0;
      if (count > 0) return `Playlist · ${count} track${count === 1 ? "" : "s"}`;
      return "Playlist";
    }
    // Radio is intentionally omitted here — it's not part of the mobile IA. Any radio row
    // that leaks through (e.g. stale cache) falls through to the generic genre label.
    if (source.genre && source.genre !== "Mixed") return source.genre;
    return null;
  })();

  const ringClass = active
    ? isController
      ? "border-sky-500/50 bg-sky-500/10"
      : "border-emerald-500/40 bg-emerald-500/10"
    : "border-slate-800/70 bg-slate-900/40 hover:bg-slate-900/70";

  const playIconRingClass = active
    ? isController
      ? "bg-sky-500/30 text-sky-300"
      : "bg-emerald-500/30 text-emerald-300"
    : "bg-slate-800/80 text-slate-200 group-hover:bg-slate-700/90";

  return (
    <div
      className={`group flex items-center gap-3 rounded-xl border transition-colors ${
        compact ? "px-2.5 py-2" : "px-3 py-2.5"
      } ${ringClass}`}
    >
      <button
        type="button"
        onClick={handlePlay}
        disabled={!canController}
        className="flex min-w-0 flex-1 items-center gap-3 text-left transition active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
      >
        <div className={`${compact ? "h-11 w-11" : "h-12 w-12"} shrink-0 overflow-hidden rounded-lg bg-slate-800/80`}>
          {source.cover ? (
            <HydrationSafeImage src={source.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-500">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-medium ${active ? "text-slate-50" : "text-slate-100"}`}>
            {source.title}
          </p>
          {metaLine && (
            <p className="truncate text-xs text-slate-400">{metaLine}</p>
          )}
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${playIconRingClass}`}>
          {active ? (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg className="ml-0.5 h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </span>
      </button>
      <MobileSourceCardActions source={source} onRemove={onRemove} editReturnTo={editReturnTo} />
    </div>
  );
}
