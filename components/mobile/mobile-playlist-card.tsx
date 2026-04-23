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
};

/**
 * Large 2-col grid tile used on the mobile Library page.
 *
 * Hierarchy target (matches the user's image-3 reference):
 *   1. square cover dominates the card (full-width aspect-square)
 *   2. cyan-neon floating Play button lives on the cover's bottom-right — reuses
 *      the SyncBiz player's neon-pill language so Library feels like the player
 *   3. title below the cover, then a compact badge + count meta row
 *
 * Play routing delegates to `DevicePlayerContext.playSourceOrSend` — same
 * single source-of-truth used by `MobileSourceRow`, so Controller / Player
 * modes both behave correctly and there is no mode-specific branching here.
 *
 * The overflow menu (edit / share / delete) floats on the cover's top-right
 * so it is always reachable from a thumb without colliding with Play.
 */
export function MobilePlaylistCard({ source, onRemove, editReturnTo }: Props) {
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

  const metaLine = (() => {
    if (isPlaylist) {
      return trackCount > 0
        ? `${trackCount} track${trackCount === 1 ? "" : "s"}`
        : "Empty";
    }
    if (source.genre && source.genre !== "Mixed") return source.genre;
    return null;
  })();

  return (
    <div className="group relative flex flex-col">
      <div
        className={`relative aspect-square w-full overflow-hidden rounded-xl bg-slate-800/80 ring-1 transition ${
          active
            ? "ring-cyan-400/60 shadow-[0_0_0_1px_rgba(34,211,238,0.35),0_0_24px_-6px_rgba(34,211,238,0.5)]"
            : "ring-slate-700/60 group-hover:ring-slate-500/70"
        }`}
      >
        {source.cover ? (
          <HydrationSafeImage src={source.cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-500">
            {isPlaylist ? (
              <svg className="h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d="M4 6h12M4 12h12M4 18h8" strokeLinecap="round" />
                <circle cx="19" cy="18" r="2.2" fill="currentColor" stroke="none" />
              </svg>
            ) : (
              <svg className="h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            )}
          </div>
        )}

        {/* Subtle gradient at the bottom — improves contrast for the floating Play button over light covers. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 via-black/15 to-transparent opacity-90"
        />

        {/* Track count pill (bottom-left) — matches the desktop library-card affordance. */}
        {isPlaylist && trackCount > 0 && (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-100 ring-1 ring-white/10">
            {trackCount}
          </span>
        )}

        {/* Overflow actions — top-right, always reachable. */}
        <div className="absolute right-1.5 top-1.5">
          <MobileSourceCardActions source={source} onRemove={onRemove} editReturnTo={editReturnTo} />
        </div>

        {/* Neon Play affordance — bottom-right of the cover.
            Reuses the cyan-neon visual language of the mobile player so the
            Library action and the player feel like the same system. */}
        <button
          type="button"
          onClick={handlePlay}
          aria-label={active ? "Pause" : "Play"}
          className="absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full border-2 border-cyan-400/70 bg-slate-900/90 text-cyan-200 shadow-[0_0_0_1px_rgba(34,211,238,0.35),0_0_22px_-4px_rgba(34,211,238,0.55)] transition hover:border-cyan-300 hover:text-cyan-100 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/60"
        >
          {active ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg className="ml-0.5 h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>

      <div className="mt-2 min-w-0">
        <p
          className={`line-clamp-2 text-[13px] font-semibold leading-snug tracking-tight ${
            active ? "text-slate-50" : "text-slate-100"
          }`}
        >
          {source.title}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <MobileTypeBadge source={source} />
          {metaLine && <span className="truncate text-[11px] text-slate-400">{metaLine}</span>}
        </div>
      </div>
    </div>
  );
}
