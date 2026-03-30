"use client";

import { useState, useEffect, useRef } from "react";
import { useLocale, useTranslations, labels } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { LibraryItemContextDeleteModal } from "@/components/library-item-context-delete-modal";
import { LibrarySourceItemActions } from "@/components/library-source-item-actions";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { RadioIcon } from "@/components/ui/radio-icon";
import { isValidStreamUrl } from "@/lib/url-validation";
import { formatViewCount, formatDuration } from "@/lib/format-utils";
import type { UnifiedSource } from "@/lib/source-types";

export type LibraryItemDeleteContext =
  | { kind: "all_library" }
  | { kind: "in_playlist"; onRemoveFromPlaylist: () => void };

type Props = {
  source: UnifiedSource;
  onRemove: (id: string, origin?: UnifiedSource["origin"]) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** Override play handler (e.g. for remote CONTROL mode). */
  onPlaySource?: (source: UnifiedSource) => void;
  /** Override stop handler (e.g. for remote CONTROL mode). */
  onStop?: () => void;
  /** Override pause handler (e.g. for remote CONTROL mode). */
  onPause?: () => void;
  /** Override active state (e.g. when showing remote master state). */
  isActive?: boolean;
  /** Match header-deck control chrome (e.g. on /sources). */
  libraryDeckChrome?: boolean;
  /** Delete modal: playlist assignment vs full library removal. Defaults to full library wording. */
  itemDeleteContext?: LibraryItemDeleteContext;
  /**
   * When set (including `null`), drives card artwork for user SyncBiz playlists: URL shows image, `null` shows playlist fallback.
   * When omitted, uses `source.cover` only (legacy behavior).
   */
  explicitArtUrl?: string | null;
  /** When set, single-click on the card opens the playlist/collection in library (debounced vs double-click). */
  onPlaylistEntityOpen?: () => void;
  /** When set, double-click plays the full playlist entity queue. */
  onPlaylistEntityPlay?: () => void;
};

function PlaylistCardArtFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`flex items-center justify-center bg-gradient-to-br from-cyan-600/30 via-slate-800/75 to-slate-950 text-cyan-400/45 ${className ?? ""}`}
    >
      <svg className="h-14 w-14 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

function SourceLogo({ type, origin, size = "md" }: { type: UnifiedSource["type"]; origin?: UnifiedSource["origin"]; size?: "sm" | "md" }) {
  const { t } = useTranslations();
  const { locale } = useLocale();
  const sizeClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const boxClass = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  const color =
    type === "youtube" ? "text-[#ff4d4d]" : type === "soundcloud" ? "text-[#ff7733]" : type === "spotify" ? "text-[#1ed760]" : "text-[color:var(--lib-text-secondary)]";
  const badge = "library-badge-logo flex items-center justify-center rounded-md backdrop-blur-sm";
  const typeTitle =
    type === "youtube"
      ? t.providerYouTube
      : type === "soundcloud"
        ? t.providerSoundCloud
        : type === "spotify"
          ? t.providerSpotify
          : t.providerLocal;
  if (origin === "radio") {
    return (
      <span className={`${badge} ${boxClass} text-rose-300`} title={labels.radio[locale]}>
        <RadioIcon className={sizeClass} />
      </span>
    );
  }
  return (
    <span className={`${badge} ${boxClass} ${color}`} title={typeTitle}>
      {type === "youtube" && (
        <svg className={sizeClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      )}
      {type === "soundcloud" && (
        <svg className={sizeClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4.5c-1.5 0-2.8.5-3.9 1.2-.5.3-.9.7-1.1 1.2-.2-.1-.4-.1-.6-.1-1.1 0-2 .9-2 2v.1c-1.5.3-2.5 1.5-2.5 3 0 1.7 1.3 3 3 3h6.5c2.2 0 4-1.8 4-4 0-2.2-1.8-4-4-4-.2 0-.4 0-.6.1-.2-1.2-1.2-2.1-2.4-2.1z" />
        </svg>
      )}
      {type === "spotify" && (
        <svg className={sizeClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02z" />
        </svg>
      )}
      {(type === "local" || type === "winamp" || type === "stream-url") && (
        <svg className={sizeClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="12" y2="17" />
        </svg>
      )}
    </span>
  );
}

export function SourceCard({
  source,
  onRemove,
  isFavorite,
  onToggleFavorite,
  draggable,
  onDragStart,
  onPlaySource: onPlaySourceProp,
  onStop: onStopProp,
  onPause: onPauseProp,
  isActive: isActiveProp,
  libraryDeckChrome = false,
  itemDeleteContext,
  explicitArtUrl,
  onPlaylistEntityOpen,
  onPlaylistEntityPlay,
}: Props) {
  const { t } = useTranslations();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const openClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { playSource, stop, pause, currentSource } = usePlayback();
  const playSourceFn = onPlaySourceProp ?? playSource;
  const stopFn = onStopProp ?? stop;
  const pauseFn = onPauseProp ?? pause;
  const active = isActiveProp ?? (mounted && currentSource?.id === source.id);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (openClickTimerRef.current) clearTimeout(openClickTimerRef.current);
    };
  }, []);
  const hasInvalidUrl = source.origin === "radio" && source.radio && !isValidStreamUrl(source.radio.url);

  async function handleDelete() {
    setDeleting(true);
    try {
      if (source.origin === "playlist" && source.playlist) {
        await fetch(`/api/playlists/${source.playlist.id}`, { method: "DELETE" });
      } else if (source.origin === "source" && source.source) {
        await fetch(`/api/sources/${source.source.id}`, { method: "DELETE" });
      } else if (source.origin === "radio" && source.radio) {
        await fetch(`/api/radio/${source.radio.id}`, { method: "DELETE" });
      }
    } finally {
      onRemove(source.id, source.origin);
      setDeleting(false);
    }
  }

  const durationSec = source.playlist?.durationSeconds ?? 0;
  const useExplicitPlaylistArt = explicitArtUrl !== undefined;
  const cardCover = useExplicitPlaylistArt ? explicitArtUrl : source.cover;

  function handleCardClickForOpen() {
    if (!onPlaylistEntityOpen) return;
    if (openClickTimerRef.current) clearTimeout(openClickTimerRef.current);
    openClickTimerRef.current = setTimeout(() => {
      onPlaylistEntityOpen();
      openClickTimerRef.current = null;
    }, 220);
  }

  function handleCardDoubleClickPlay(e: React.MouseEvent) {
    if (!onPlaylistEntityPlay) return;
    e.preventDefault();
    if (openClickTimerRef.current) {
      clearTimeout(openClickTimerRef.current);
      openClickTimerRef.current = null;
    }
    onPlaylistEntityPlay();
  }

  return (
    <>
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onPlaylistEntityOpen ? handleCardClickForOpen : undefined}
      onDoubleClick={onPlaylistEntityPlay ? handleCardDoubleClickPlay : undefined}
      className={`library-source-card group flex flex-col overflow-hidden rounded-2xl backdrop-blur-md transition-transform duration-200 ease-out hover:-translate-y-0.5 ${
        active ? "library-playing-active" : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="library-card-art-bg relative aspect-[4/3] w-full overflow-hidden">
        {cardCover ? (
          <>
            <HydrationSafeImage src={cardCover} alt="" className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]" />
            <div className="library-card-art-overlay pointer-events-none absolute inset-0" aria-hidden />
            {source.origin === "radio" && (
              <span className="library-live-badge absolute right-2 top-2 rounded-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-lg backdrop-blur-sm">
                {t.live}
              </span>
            )}
            {durationSec > 0 && (
              <span className="library-pill-overlay library-pill-overlay-soft absolute bottom-2 right-2 rounded-md px-2 py-0.5 text-[10px] font-medium tabular-nums shadow-lg backdrop-blur-md">
                {formatDuration(durationSec)}
              </span>
            )}
          </>
        ) : null}
        {hasInvalidUrl && (
          <div
            className="absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/90 text-slate-900"
            title={t.invalidStreamUrlTitle}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              <line x1="12" y1="9" x2="12" y2="13" />
            </svg>
          </div>
        )}
        {!cardCover && useExplicitPlaylistArt && (
          <div className="relative h-full w-full">
            <PlaylistCardArtFallback className="h-full w-full" />
            {durationSec > 0 && (
              <span className="library-pill-overlay library-pill-overlay-soft absolute bottom-2 right-2 rounded-md px-2 py-0.5 text-[10px] font-medium tabular-nums backdrop-blur-md">
                {formatDuration(durationSec)}
              </span>
            )}
          </div>
        )}
        {!cardCover && !useExplicitPlaylistArt && (
          <div className="library-card-placeholder-bg relative flex h-full w-full items-center justify-center">
            <svg className="h-14 w-14 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            {durationSec > 0 && (
              <span className="library-pill-overlay library-pill-overlay-soft absolute bottom-2 right-2 rounded-md px-2 py-0.5 text-[10px] font-medium tabular-nums backdrop-blur-md">
                {formatDuration(durationSec)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="library-card-footer flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="library-card-title min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug tracking-tight">
            {source.title}
          </h3>
          <div className="flex items-center gap-1">
            {onToggleFavorite && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
                className={`rounded-md p-0.5 transition-colors duration-200 hover:bg-[color:var(--lib-surface-card-hover)] ${isFavorite ? "text-amber-400" : "text-[color:var(--lib-text-secondary)] hover:text-amber-400/80"}`}
                title={isFavorite ? t.removeFromFavorites : t.addToFavorites}
                aria-label={isFavorite ? t.removeFromFavorites : t.addToFavorites}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            )}
            <SourceLogo type={source.type} origin={source.origin} size="md" />
          </div>
        </div>
        {(source.genre ||
          (source.viewCount ?? source.playlist?.viewCount) != null ||
          (durationSec > 0 && !cardCover)) && (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              {source.genre && (
                <p className="library-card-meta text-[10px] font-semibold uppercase tracking-[0.14em]">{source.genre}</p>
              )}
              <div className="library-card-meta ml-auto flex items-center gap-2 text-[11px] tabular-nums">
                {(source.viewCount ?? source.playlist?.viewCount) != null && (
                  <span>{formatViewCount(source.viewCount ?? source.playlist?.viewCount ?? 0)} {t.views}</span>
                )}
                {(source.viewCount ?? source.playlist?.viewCount) != null && durationSec > 0 && !cardCover && (
                  <span className="library-card-meta-muted">•</span>
                )}
                {durationSec > 0 && !cardCover && <span>{formatDuration(durationSec)}</span>}
              </div>
            </div>
          </div>
        )}
        <LibrarySourceItemActions
          source={source}
          onPlay={() => playSourceFn(source)}
          isActive={active}
          onStop={stopFn}
          onPause={pauseFn}
          libraryDeckChrome={libraryDeckChrome}
          onShareOpen={() => setShareOpen(true)}
          onDeletePress={() => setDeleteOpen(true)}
        />
      </div>
      {shareOpen ? (
        <ShareModal
          item={unifiedSourceToShareable(source)}
          fallbackPlaylistId={source.origin === "playlist" ? source.id : undefined}
          fallbackRadioId={source.origin === "radio" && source.radio ? source.radio.id : undefined}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </article>
    <LibraryItemContextDeleteModal
      isOpen={deleteOpen}
      onClose={() => setDeleteOpen(false)}
      variant={itemDeleteContext?.kind === "in_playlist" ? "in_playlist" : "all_library"}
      onRemoveFromPlaylist={itemDeleteContext?.kind === "in_playlist" ? itemDeleteContext.onRemoveFromPlaylist : undefined}
      onDeleteFromLibrary={handleDelete}
      loading={deleting}
      showDeleteFromLibrary={
        source.origin === "playlist" || source.origin === "source" || source.origin === "radio"
      }
    />
    </>
  );
}
