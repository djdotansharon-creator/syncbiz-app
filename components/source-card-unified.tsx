"use client";

import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { LibraryItemContextDeleteModal } from "@/components/library-item-context-delete-modal";
import { LibrarySourceItemActions } from "@/components/library-source-item-actions";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { isValidStreamUrl, isValidLocalFilePlaybackPath } from "@/lib/url-validation";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { formatDuration } from "@/lib/format-utils";
import {
  libraryCardDisplayGenre,
  type UnifiedSource,
} from "@/lib/source-types";
import {
  libraryKindBadgeUpper,
  libraryKindBadgeArtClass,
  resolveLibraryKindBadge,
  isLibraryLocalSource,
} from "@/lib/library-display-classification";
import { LibraryBrowseCardSurface } from "@/components/player-surface/library-browse-card-surface";
import type { LeafDisplayMetaPatch } from "@/lib/library-leaf-display-refresh-client";
import {
  leafMetadataNeedsEnrichment,
  scheduleLeafMetadataEnrichment,
} from "@/lib/library-card-leaf-metadata-queue";
import { LibraryCardLeafMetaFooter, LibraryCardPlaylistMetaFooter } from "@/components/library-card-meta-footer";
import { TrackMediaPlaceholder } from "@/components/track-source-visual";
import { inferTrackSourceChip } from "@/lib/track-source-chip";
import "@/components/player-surface/library-browse-card-surface.css";

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
  /** @deprecated Non–leaf-card paths only; leaf cards use add-to-playlist (`leafUnifiedBar`). */
  onAddToLibrary?: () => void | Promise<void>;
  /** When set, "Delete from library" runs this (e.g. resolves expanded playlist rows to src-*). */
  onLibraryDelete?: (item: UnifiedSource) => void | Promise<void>;
  /** When set, controls whether the modal shows "Delete from library". Omit = only real persisted entities. */
  libraryDeleteEligible?: boolean;
  /** @deprecated Leaf bar does not show in-library chip. */
  expandedTrackInMainLibrary?: boolean;
  /** Leaf item card: unified Play / Edit / + / Share / Delete (no add-to-library). */
  leafUnifiedBar?: boolean;
  /** Opens add-to-playlist picker (required when `leafUnifiedBar`). */
  onAddToPlaylistPress?: () => void;
  /** Optional ⋯ AI tools slot on LIST shell tiles (outside leaf rows). */
  playlistAiMenuSlot?: ReactNode;
  /** When set, shows a clock action that opens the day/hour schedule window for this playlist. */
  onSchedulePress?: () => void;
  /** Compact "when it plays" line shown when the playlist has an active schedule. */
  scheduleLine?: string | null;
  /** @deprecated Ignored — all grid cards use the unified library browse shell. */
  libraryTilePresentation?: "rich" | "branch";
};

function unifiedSourceHasPersistedLibraryEntity(s: UnifiedSource): boolean {
  return (
    (s.origin === "playlist" && !!s.playlist) ||
    (s.origin === "source" && !!s.source) ||
    (s.origin === "radio" && !!s.radio)
  );
}

function PlaylistCardArtFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`flex items-center justify-center bg-gradient-to-br from-cyan-600/30 via-slate-800/75 to-slate-950 text-cyan-400/45 ${className ?? ""}`}
    >
      <svg className="h-10 w-10 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

/** Platform mark for the top-right corner — a logo, not text. Internal SyncBiz entities show nothing. */
function resolveCardPlatform(source: UnifiedSource): "youtube" | "soundcloud" | "spotify" | "radio" | "local" | null {
  if (source.origin === "radio") return "radio";
  if (isLibraryLocalSource(source)) return "local";
  if (source.type === "youtube") return "youtube";
  if (source.type === "soundcloud") return "soundcloud";
  if (source.type === "spotify") return "spotify";
  return null;
}

function PlatformLogoBadge({ platform }: { platform: NonNullable<ReturnType<typeof resolveCardPlatform>> }) {
  const title =
    platform === "youtube" ? "YouTube" : platform === "soundcloud" ? "SoundCloud" : platform === "spotify" ? "Spotify" : platform === "radio" ? "Radio" : "Local";
  return (
    <span
      className="flex items-center justify-center drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]"
      title={title}
      aria-label={title}
    >
      {platform === "youtube" ? (
        <svg className="h-5 w-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" fill="#ff0000" />
          <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#ffffff" />
        </svg>
      ) : platform === "soundcloud" ? (
        <svg className="h-5 w-5 text-[#ff5500]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 4.5c-1.5 0-2.8.5-3.9 1.2-.5.3-.9.7-1.1 1.2-.2-.1-.4-.1-.6-.1-1.1 0-2 .9-2 2v.1c-1.5.3-2.5 1.5-2.5 3 0 1.7 1.3 3 3 3h6.5c2.2 0 4-1.8 4-4 0-2.2-1.8-4-4-4-.2 0-.4 0-.6.1-.2-1.2-1.2-2.1-2.4-2.1z" />
        </svg>
      ) : platform === "spotify" ? (
        <svg className="h-5 w-5 text-[#1db954]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.83-1.73-6.39-2.12-10.58-1.16a.75.75 0 1 1-.33-1.46c4.58-1.05 8.51-.6 11.68 1.34.36.22.47.68.26 1.03zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.24-1.99-8.17-2.57-12-1.4a.94.94 0 1 1-.55-1.79c4.38-1.35 9.82-.7 13.53 1.59.44.27.58.85.31 1.29zm.13-3.4C15.24 8.32 8.84 8.11 5.13 9.23a1.12 1.12 0 1 1-.65-2.15c4.26-1.29 11.34-1.04 15.81 1.61a1.12 1.12 0 0 1-1.19 1.94z" />
        </svg>
      ) : platform === "radio" ? (
        <svg className="h-5 w-5 text-[#fb7185]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="8" width="20" height="12" rx="2" />
          <path d="M6 8L18 3" />
          <circle cx="8" cy="14" r="2.5" />
          <path d="M16 12h2M16 16h2" />
        </svg>
      ) : (
        <svg className="h-5 w-5 text-[#93c5fd]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="4" width="20" height="14" rx="2" />
          <path d="M8 22h8M12 18v4" />
        </svg>
      )}
    </span>
  );
}

/** Playlist that plays computer files (fully or partially) — a clear mark that downloads the desktop app. */
function DesktopGetAppBadge({ label = "Get Desktop", title }: { label?: string; title?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        void (async () => {
          try {
            const res = await fetch("/api/desktop/download", { cache: "no-store" });
            const data = res.ok ? ((await res.json()) as { url?: string }) : null;
            const url = typeof data?.url === "string" && data.url.trim() ? data.url.trim() : null;
            if (url) window.open(url, "_blank", "noopener");
          } catch {
            /* download endpoint unavailable — the header button remains the fallback */
          } finally {
            setBusy(false);
          }
        })();
      }}
      title={title ?? "Plays files from this computer — available in the SyncBiz desktop app. Click to download."}
      aria-label="Download the SyncBiz desktop app"
      className="flex items-center gap-1 rounded-md border border-[#0a84ff]/40 bg-[#0a84ff]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-[#a8ccff] backdrop-blur-sm transition-colors hover:border-[#0a84ff] hover:bg-[#0a84ff]/30 hover:text-white disabled:opacity-60"
    >
      <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v10" />
        <path d="M8 9l4 4 4-4" />
        <path d="M4 17h16v4H4z" />
      </svg>
      {busy ? "…" : label}
    </button>
  );
}

function ArtTopRightCorner({
  source,
  showDesktopOnly,
  desktopDownloadCta = false,
  desktopOnlyTrackCount = 0,
}: {
  source: UnifiedSource;
  showDesktopOnly: boolean;
  desktopDownloadCta?: boolean;
  /** Mixed playlist: how many of its tracks are computer files (browser can't play them). */
  desktopOnlyTrackCount?: number;
}) {
  const platform = resolveCardPlatform(source);
  if (!platform && !showDesktopOnly && !desktopDownloadCta && desktopOnlyTrackCount === 0) return null;
  return (
    <div className="library-card-art-top-right absolute right-1.5 top-1.5 z-10 flex flex-col items-end gap-0.5">
      {desktopDownloadCta ? (
        <DesktopGetAppBadge />
      ) : platform ? (
        <PlatformLogoBadge platform={platform} />
      ) : null}
      {!desktopDownloadCta && desktopOnlyTrackCount > 0 ? (
        <DesktopGetAppBadge
          label={`${desktopOnlyTrackCount} on Desktop`}
          title={`${desktopOnlyTrackCount} song${desktopOnlyTrackCount === 1 ? "" : "s"} in this playlist play only in the SyncBiz desktop app — the browser plays the rest. Click to download.`}
        />
      ) : null}
      {showDesktopOnly ? (
        <span className="library-card-desktop-only-badge" title="Requires SyncBiz desktop app">
          Desktop only
        </span>
      ) : null}
    </div>
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
  onAddToLibrary,
  onLibraryDelete,
  libraryDeleteEligible,
  expandedTrackInMainLibrary = false,
  leafUnifiedBar = false,
  onAddToPlaylistPress,
  playlistAiMenuSlot,
  onSchedulePress,
  scheduleLine,
  libraryTilePresentation: _libraryTilePresentation = "rich",
}: Props) {
  const { t } = useTranslations();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isBrowserShell, setIsBrowserShell] = useState(true);
  const openClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { playSource, stop, pause, currentSource, currentPlaylist } = usePlayback();
  const playSourceFn = onPlaySourceProp ?? playSource;
  const stopFn = onStopProp ?? stop;
  const pauseFn = onPauseProp ?? pause;
  const active = isActiveProp ?? (mounted && currentSource?.id === source.id);

  const [displayMetaPatch, setDisplayMetaPatch] = useState<LeafDisplayMetaPatch>({});
  const articleRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setDisplayMetaPatch({});
  }, [source.id]);

  useEffect(() => {
    setMounted(true);
    setIsBrowserShell(typeof window === "undefined" || !("syncbizDesktop" in window));
  }, []);

  useEffect(() => {
    return () => {
      if (openClickTimerRef.current) clearTimeout(openClickTimerRef.current);
    };
  }, []);
  const hasInvalidUrl = source.origin === "radio" && source.radio && !isValidStreamUrl(source.radio.url);

  async function runDeleteFromLibraryFlow() {
    setDeleting(true);
    try {
      if (onLibraryDelete) {
        await onLibraryDelete(source);
        return;
      }
      if (source.origin === "playlist" && source.playlist) {
        await fetch(`/api/playlists/${source.playlist.id}`, { method: "DELETE" });
      } else if (source.origin === "source" && source.source) {
        await fetch(`/api/sources/${source.source.id}`, { method: "DELETE" });
      } else if (source.origin === "radio" && source.radio) {
        await fetch(`/api/radio/${source.radio.id}`, { method: "DELETE" });
      }
    } finally {
      if (!onLibraryDelete) {
        onRemove(source.id, source.origin);
      }
      setDeleting(false);
    }
  }

  const kindBadge = resolveLibraryKindBadge(source);
  const badgeText = libraryKindBadgeUpper(kindBadge);
  const showLeafLibraryChips = kindBadge !== "LIST" && kindBadge !== "RADIO";
  const provenanceChip = inferTrackSourceChip(source);
  const showDesktopOnly =
    isLibraryLocalSource(source) && kindBadge !== "LIST" && kindBadge !== "RADIO" && isBrowserShell;
  const playDisabled = showDesktopOnly;
  /** Local playlists can't play in the browser — surface a "get the desktop app" mark instead. */
  const desktopOnlyPlaylist = isBrowserShell && kindBadge === "LIST" && isLibraryLocalSource(source);
  /** MIXED playlist (URLs + computer files): count the desktop-only tracks for a partial mark. */
  const desktopOnlyTrackCount = useMemo(() => {
    if (!isBrowserShell || kindBadge !== "LIST" || desktopOnlyPlaylist || !source.playlist) return 0;
    let n = 0;
    for (const t of getPlaylistTracks(source.playlist)) {
      const u = (t.url ?? "").trim();
      if (u.startsWith("local://") || isValidLocalFilePlaybackPath(u)) n++;
    }
    return n;
  }, [isBrowserShell, kindBadge, desktopOnlyPlaylist, source.playlist]);

  const sourceForLeafDisplay = useMemo(() => {
    const p = displayMetaPatch;
    if (!p || Object.keys(p).length === 0) return source;
    const next: UnifiedSource = { ...source };
    if (p.viewCount != null) next.viewCount = p.viewCount;
    if (p.likeCount != null) next.likeCount = p.likeCount;
    if (p.publishedAt != null) next.publishedAt = p.publishedAt;
    if (p.leafDurationSeconds != null) next.leafDurationSeconds = p.leafDurationSeconds;
    return next;
  }, [source, displayMetaPatch]);

  const durationSec =
    sourceForLeafDisplay.leafDurationSeconds ?? sourceForLeafDisplay.playlist?.durationSeconds ?? 0;

  const scheduleLeafDisplayMetadataRefresh = useCallback(() => {
    if (!showLeafLibraryChips || source.type !== "youtube") return;
    const url = source.url?.trim();
    if (!url) return;
    void scheduleLeafMetadataEnrichment(url).then((patch) => {
      if (!patch || Object.keys(patch).length === 0) return;
      setDisplayMetaPatch((prev) => ({ ...prev, ...patch }));
    });
  }, [showLeafLibraryChips, source.type, source.url]);

  useEffect(() => {
    if (!showLeafLibraryChips || source.type !== "youtube") return;
    if (!leafMetadataNeedsEnrichment(source)) return;
    const el = articleRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const url = source.url?.trim();
        if (!url) return;
        void scheduleLeafMetadataEnrichment(url).then((patch) => {
          if (!patch || Object.keys(patch).length === 0) return;
          setDisplayMetaPatch((prev) => ({ ...prev, ...patch }));
        });
      },
      { rootMargin: "80px", threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [source.id, source.url, source.type, showLeafLibraryChips, source.viewCount, source.likeCount, source.publishedAt, source.leafDurationSeconds]);

  const useExplicitPlaylistArt = explicitArtUrl !== undefined;
  const cardCover = useExplicitPlaylistArt ? explicitArtUrl : source.cover;
  const usePlaylistPlaceholder = kindBadge === "LIST" && !cardCover;
  const cardGenre = libraryCardDisplayGenre(source);
  const leafMetaFooter = showLeafLibraryChips ? (
    <LibraryCardLeafMetaFooter source={sourceForLeafDisplay} showDesktopOnly={showDesktopOnly} />
  ) : null;
  const playlistMetaFooter = kindBadge === "LIST" ? <LibraryCardPlaylistMetaFooter source={source} /> : null;
  const metaFooter = playlistMetaFooter ?? leafMetaFooter;

  function handleCardClickForOpen(e: React.MouseEvent) {
    if (!onPlaylistEntityOpen) return;
    const tgt = e.target as HTMLElement | null;
    if (
      tgt?.closest?.(".library-source-deck-actions") ||
      tgt?.closest?.(".sb-lbc-title-aside")
    ) {
      return;
    }
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

  const titleAsideNode = (
    <>
      {onSchedulePress && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSchedulePress();
          }}
          className="rounded-md p-0.5 text-[color:var(--lib-text-secondary)] transition-colors duration-200 hover:bg-[color:var(--lib-surface-card-hover)] hover:text-[#7db8ff]"
          title="Schedule playlist"
          aria-label="Schedule playlist"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
      )}
      {onToggleFavorite && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={`rounded-md p-0.5 transition-colors duration-200 hover:bg-[color:var(--lib-surface-card-hover)] ${isFavorite ? "text-amber-400" : "text-[color:var(--lib-text-secondary)] hover:text-amber-400/80"}`}
          title={isFavorite ? t.removeFromFavorites : t.addToFavorites}
          aria-label={isFavorite ? t.removeFromFavorites : t.addToFavorites}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      )}
      {playlistAiMenuSlot}
    </>
  );

  const sourceActions = (
    <LibrarySourceItemActions
      source={source}
      onPlay={() => {
        if (openClickTimerRef.current) {
          clearTimeout(openClickTimerRef.current);
          openClickTimerRef.current = null;
        }
        scheduleLeafDisplayMetadataRefresh();
        const pl = currentPlaylist;
        const playTarget =
          pl && (source.playlist?.id === pl.id || currentSource?.id === source.id)
            ? { ...source, playlist: pl }
            : source;
        playSourceFn(playTarget);
      }}
      isActive={active}
      onStop={stopFn}
      onPause={pauseFn}
      libraryDeckChrome={libraryDeckChrome}
      onShareOpen={() => setShareOpen(true)}
      onDeletePress={() => setDeleteOpen(true)}
      actionLayout={leafUnifiedBar ? "leaf" : "default"}
      onAddToPlaylistPress={leafUnifiedBar ? onAddToPlaylistPress : undefined}
      onAddToLibrary={leafUnifiedBar ? undefined : onAddToLibrary}
      inLibrary={leafUnifiedBar ? false : expandedTrackInMainLibrary}
      playDisabled={playDisabled}
      playDisabledTitle="Desktop only"
    />
  );

  const isDiskLocalPlaylist = source.origin === "source" && source.source?.type === "local_playlist";
  const cardKindClass =
    kindBadge === "LIST"
      ? "library-source-card--playlist"
      : kindBadge === "SET"
        ? "library-source-card--set"
        : kindBadge === "LOCAL"
          ? "library-source-card--local"
          : "";

  return (
    <>
    <article
      ref={articleRef}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onPlaylistEntityOpen ? handleCardClickForOpen : undefined}
      onDoubleClick={onPlaylistEntityPlay ? handleCardDoubleClickPlay : undefined}
      className={`library-source-card group flex h-auto min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-xl backdrop-blur-md transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-px ${cardKindClass} ${
        showLeafLibraryChips ? "library-source-card-leaf" : ""
      } ${active ? "library-playing-active" : ""} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }${isDiskLocalPlaylist ? " library-source-card--local-disk" : ""}`}
    >
      <LibraryBrowseCardSurface
        as="div"
        className="min-h-0 flex shrink-0 flex-col"
        artSlot={
          <div className="library-card-art-bg relative aspect-[4/3] w-full min-h-0 shrink-0 overflow-hidden">
            <span
              className={`library-card-kind-badge pointer-events-none absolute left-1.5 top-1.5 z-10 ${libraryKindBadgeArtClass(kindBadge)}`}
              aria-hidden
            >
              {badgeText}
            </span>
            <ArtTopRightCorner
              source={source}
              showDesktopOnly={showDesktopOnly}
              desktopDownloadCta={desktopOnlyPlaylist}
              desktopOnlyTrackCount={desktopOnlyTrackCount}
            />
            {cardCover ? (
              <>
                <HydrationSafeImage src={cardCover} alt="" className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]" />
                <div className="library-card-art-overlay pointer-events-none absolute inset-0" aria-hidden />
                {source.origin === "radio" && (
                  <span className="library-live-badge absolute left-2 bottom-2 rounded-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-lg backdrop-blur-sm">
                    {t.live}
                  </span>
                )}
              </>
            ) : null}
            {hasInvalidUrl && (
              <div
                className="absolute bottom-2 left-2 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/90 text-slate-900"
                title={t.invalidStreamUrlTitle}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                </svg>
              </div>
            )}
            {!cardCover && (usePlaylistPlaceholder || useExplicitPlaylistArt) ? (
              <div className="relative h-full w-full">
                <PlaylistCardArtFallback className="h-full w-full" />
              </div>
            ) : null}
            {!cardCover && !usePlaylistPlaceholder && !useExplicitPlaylistArt ? (
              <div className="relative h-full w-full">
                <TrackMediaPlaceholder chip={provenanceChip} className="h-full w-full" showCornerBadge={false} />
              </div>
            ) : null}
            {durationSec > 0 && (kindBadge === "SET" || kindBadge === "LIST" || kindBadge === "RADIO") ? (
              <span
                className={`library-pill-overlay library-pill-overlay-soft absolute bottom-2 right-2 rounded-md px-2 py-0.5 font-medium tabular-nums shadow-lg backdrop-blur-md ${
                  kindBadge === "SET" ? "library-card-duration-set text-[11px]" : "text-[10px]"
                }`}
              >
                {formatDuration(durationSec)}
              </span>
            ) : null}
          </div>
        }
        title={source.title}
        metaLine=""
        titleAside={titleAsideNode}
      >
        <p className="library-card-genre-line m-0">
          <span className="library-card-genre-label">Genre</span>
          <span className="library-card-genre-value">{cardGenre}</span>
        </p>
        {scheduleLine ? (
          <p className="m-0 flex items-start gap-1 text-[10px] font-medium leading-snug text-[#6cb2ff]">
            <svg className="mt-[1px] h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="min-w-0">{scheduleLine}</span>
          </p>
        ) : null}
        <div className="library-card-actions-wrap">{sourceActions}</div>
        {metaFooter ? <div className="library-card-stats-wrap">{metaFooter}</div> : null}
      </LibraryBrowseCardSurface>
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
      onDeleteFromLibrary={() => void runDeleteFromLibraryFlow()}
      loading={deleting}
      showDeleteFromLibrary={libraryDeleteEligible ?? unifiedSourceHasPersistedLibraryEntity(source)}
    />
    </>
  );
}
