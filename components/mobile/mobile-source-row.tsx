"use client";

import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { MobileSourceCardActions } from "@/components/mobile-source-card-actions";
import { MobileTypeBadge } from "@/components/mobile/mobile-type-badge";
import { useMobileRole } from "@/lib/mobile-role-context";
import { useStationController } from "@/lib/station-controller-context";
import { useDevicePlayer } from "@/lib/device-player-context";
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
 * MobileSourceCard / MobileSourceCardLocal pair.
 *
 * Play routing (fixed): we delegate to `DevicePlayerContext.playSourceOrSend`
 * which is the single source-of-truth router used by the main sources
 * manager. It auto-selects between:
 *   - MASTER (effectiveDeviceMode === "MASTER") → `playSource(...)` locally
 *   - CONTROL → `sendCommandToMaster("PLAY_SOURCE", ...)` over the WS
 *
 * Previously we routed ourselves based on the `mobileRole` toggle and called
 * `usePlayback().playSource` directly, which is silently gated by
 * `deviceModeAllowsLocalPlayback` (only true when `effectiveDeviceMode`
 * is `MASTER` on an eligible route). That caused taps in Player mode to do
 * nothing whenever the branch socket hadn't been promoted to MASTER. Using
 * `playSourceOrSend` removes the mismatch and makes the row reliable in
 * both Controller and Player modes.
 *
 * The `mobileRole` toggle is still consulted for the active-ring color and
 * the disabled-state hint, but the action itself is no longer gated by it.
 *
 * The overflow menu (edit / share / delete) is identical in both modes.
 */
export function MobileSourceRow({ source, onRemove, editReturnTo, compact = false }: Props) {
  const { mobileRole } = useMobileRole();
  const station = useStationController();
  const deviceCtx = useDevicePlayer();
  const playbackCtx = usePlayback();

  const isController = mobileRole === "controller";
  const remoteActive = station.remoteState?.currentSource?.id === source.id;
  const localActive =
    playbackCtx.currentSource?.id === source.id && playbackCtx.status !== "idle";
  const active = (isController ? remoteActive : localActive) || (!isController && remoteActive);

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deviceCtx?.playSourceOrSend) {
      deviceCtx.playSourceOrSend(source);
      return;
    }
    if (isController && station.isCrossDevice) {
      station.sendPlaySource(source);
      return;
    }
    playbackCtx.playSource(source);
  };

  const isPlaylist = source.origin === "playlist";
  const trackCount = isPlaylist ? source.playlist?.tracks?.length ?? 0 : 0;

  // Meta line: playlist track count, or provider name for a single track.
  // The `MobileTypeBadge` below always handles the "Playlist vs Track" label
  // itself, so the meta line only adds secondary info (count, genre, provider).
  const metaLine = (() => {
    if (isPlaylist) {
      return trackCount > 0
        ? `${trackCount} track${trackCount === 1 ? "" : "s"}`
        : "Empty playlist";
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
        className="flex min-w-0 flex-1 items-center gap-3 text-left transition active:scale-[0.99]"
      >
        <div
          className={`${compact ? "h-11 w-11" : "h-12 w-12"} relative shrink-0 overflow-hidden rounded-lg bg-slate-800/80`}
        >
          {source.cover ? (
            <HydrationSafeImage src={source.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-500">
              {isPlaylist ? (
                // Stacked-rows icon for playlists (multi-track container).
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M4 6h12M4 12h12M4 18h8" strokeLinecap="round" />
                  <circle cx="19" cy="18" r="2" fill="currentColor" stroke="none" />
                </svg>
              ) : (
                // Single-note icon for tracks / single URLs.
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              )}
            </div>
          )}
          {isPlaylist && trackCount > 0 && (
            <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] font-semibold leading-[14px] text-slate-200">
              {trackCount}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-medium ${active ? "text-slate-50" : "text-slate-100"}`}>
            {source.title}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <MobileTypeBadge source={source} />
            {metaLine && (
              <span className="truncate text-xs text-slate-400">{metaLine}</span>
            )}
          </div>
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
