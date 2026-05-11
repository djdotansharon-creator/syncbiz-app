"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLocale, useTranslations, labels } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { LibraryItemContextDeleteModal } from "@/components/library-item-context-delete-modal";
import { LibrarySourceItemActions } from "@/components/library-source-item-actions";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { RadioIcon } from "@/components/ui/radio-icon";
import { isValidStreamUrl } from "@/lib/url-validation";
import {
  formatViewCount,
  formatDuration,
  formatDurationClock,
  formatPublishedMonthYearCompact,
  formatSyncBizCurationChip,
} from "@/lib/format-utils";
import {
  libraryCardDisplayGenre,
  libraryCardEffectiveViewCount,
  libraryCardShouldShowMetaRow,
  libraryCardEffectiveLikeCount,
  libraryCardEffectivePublishedAt,
  libraryCardEffectiveCuration,
  type UnifiedSource,
} from "@/lib/source-types";
import {
  libraryKindBadgeUpper,
  libraryKindBadgeArtClass,
  resolveLibraryKindBadge,
} from "@/lib/library-display-classification";
import { BranchLibraryBrowseCard } from "@/components/player-surface/branch-library-browse-card";
import { LibraryBrowseCardSurface } from "@/components/player-surface/library-browse-card-surface";
import { branchLibraryItemMetaLine } from "@/lib/player-surface/branch-library-list-item";
import { unifiedSourceToBranchLibraryListItem } from "@/lib/player-surface/unified-to-branch-library-item";
import { fetchLeafDisplayMetadataRefresh, type LeafDisplayMetaPatch } from "@/lib/library-leaf-display-refresh-client";
import { ListContainerMetadataStrip } from "@/components/library-list-container-meta-strip";
import { getLibraryListContainerMetaStripModel } from "@/lib/library-list-container-display";
import { CompactSourceBadge, TrackMediaPlaceholder } from "@/components/track-source-visual";
import { inferTrackSourceChip } from "@/lib/track-source-chip";
import "@/components/player-surface/library-browse-card-surface.css";

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Icon-first stats row for leaf URL library cards (not LIST/RADIO containers). Omits empty fields. */
function LeafUrlMetadataStrip({ source }: { source: UnifiedSource }) {
  const [heartActive, setHeartActive] = useState(false);

  useEffect(() => {
    setHeartActive(false);
  }, [source.id]);

  const effectiveViews = libraryCardEffectiveViewCount(source);
  const effectiveLikes = libraryCardEffectiveLikeCount(source);
  const publishedAtRaw = libraryCardEffectivePublishedAt(source);
  const durationSec = source.leafDurationSeconds ?? source.playlist?.durationSeconds ?? 0;

  const showViews = effectiveViews != null && Number.isFinite(effectiveViews);
  const viewsVal = showViews ? formatViewCount(effectiveViews!) : "";

  const showLikes = effectiveLikes != null && Number.isFinite(effectiveLikes);
  const likesVal = showLikes ? formatViewCount(effectiveLikes!) : "";

  const showDuration = durationSec > 0;
  const durVal = showDuration ? formatDurationClock(durationSec) : "";

  let pubVal = "";
  if (publishedAtRaw) {
    const compact = formatPublishedMonthYearCompact(publishedAtRaw);
    if (compact) pubVal = compact;
  }
  const showPublished = Boolean(pubVal);

  const curation = libraryCardEffectiveCuration(source);
  const syncLabel =
    curation != null && Number.isFinite(curation) && curation > 0 ? formatSyncBizCurationChip(curation) : "";
  const showSync = syncLabel !== "" && syncLabel !== "—";

  const iconEyeClass = "h-3.5 w-3.5 shrink-0 text-sky-400 drop-shadow-[0_0_6px_rgba(56,189,248,0.35)]";
  const iconClockClass = "h-3.5 w-3.5 shrink-0 text-teal-300 drop-shadow-[0_0_6px_rgba(45,212,191,0.25)]";
  const valClass = "text-[12px] font-semibold tabular-nums tracking-tight text-slate-100";

  if (!showViews && !showLikes && !showDuration && !showPublished && !showSync) {
    return null;
  }

  return (
    <div
      className="library-leaf-meta-strip flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-2.5 pl-1 pr-0.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="group"
      aria-label="Track stats"
    >
      {showViews ? (
        <span className="inline-flex items-center gap-1.5" title="Views">
          <EyeIcon className={iconEyeClass} />
          <span className={valClass}>{viewsVal}</span>
        </span>
      ) : null}

      {showLikes ? (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            className="-m-0.5 rounded-md p-1 text-rose-500 transition-colors hover:bg-rose-500/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/55"
            aria-pressed={heartActive}
            aria-label={heartActive ? "Unlike" : "Like"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setHeartActive((v) => !v);
            }}
          >
            <svg
              className={`h-4 w-4 transition-[transform,color] duration-200 ${heartActive ? "scale-105 text-rose-300" : "text-rose-500"}`}
              viewBox="0 0 24 24"
              fill={heartActive ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path
                d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className={`${valClass} pl-0.5`} title="Likes">
            {likesVal}
          </span>
        </span>
      ) : null}

      {showDuration ? (
        <span className="inline-flex items-center gap-1.5" title="Duration">
          <ClockIcon className={iconClockClass} />
          <span className={valClass}>{durVal}</span>
        </span>
      ) : null}

      {showPublished ? (
        <span className="inline-flex items-center gap-1.5" title="Published">
          <span className={`${valClass} text-[11px] font-semibold uppercase tracking-wide text-slate-200/90`}>{pubVal}</span>
        </span>
      ) : null}

      {showSync ? (
        <span
          className="inline-flex items-center rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200/95"
          title="SyncBiz curation"
        >
          {syncLabel}
        </span>
      ) : null}
    </div>
  );
}

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
  /**
   * `rich` = full web tile (custom art, view counts, duration pills).
   * `branch` = shared `BranchLibraryBrowseCard` shell (same structure as desktop branch library grid).
   */
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
      <svg className="h-14 w-14 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

function SourceLogo({
  type,
  origin,
  size = "md",
  preferStreamProviderGlyph = false,
}: {
  type: UnifiedSource["type"];
  origin?: UnifiedSource["origin"];
  size?: "sm" | "md";
  /** When true, show YouTube/SoundCloud/Spotify mark even if `origin === "playlist"` (leaf single in library). */
  preferStreamProviderGlyph?: boolean;
}) {
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
  if (origin === "playlist" && !preferStreamProviderGlyph) {
    return (
      <span className={`${badge} ${boxClass} text-cyan-300/90`} title={t.scheduleTargetPlaylist}>
        <svg className={sizeClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
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
  onAddToLibrary,
  onLibraryDelete,
  libraryDeleteEligible,
  expandedTrackInMainLibrary = false,
  leafUnifiedBar = false,
  onAddToPlaylistPress,
  libraryTilePresentation = "rich",
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

  const [displayMetaPatch, setDisplayMetaPatch] = useState<LeafDisplayMetaPatch>({});
  const lastLeafRefreshAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setDisplayMetaPatch({});
  }, [source.id]);

  useEffect(() => {
    setMounted(true);
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

  const branchListItem =
    libraryTilePresentation === "branch" ? unifiedSourceToBranchLibraryListItem(source) : null;
  const useBranchTileShell = libraryTilePresentation === "branch" && branchListItem != null;

  const kindBadge = resolveLibraryKindBadge(source);
  const badgeText = libraryKindBadgeUpper(kindBadge);
  const showLeafLibraryChips = kindBadge !== "LIST" && kindBadge !== "RADIO";
  const provenanceChip = inferTrackSourceChip(source);

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

  const LEAF_DISPLAY_REFRESH_COOLDOWN_MS = 45_000;

  const scheduleLeafDisplayMetadataRefresh = useCallback(() => {
    if (!showLeafLibraryChips) return;
    const url = source.url?.trim();
    if (!url) return;
    const now = Date.now();
    const last = lastLeafRefreshAtRef.current.get(source.id) ?? 0;
    if (now - last < LEAF_DISPLAY_REFRESH_COOLDOWN_MS) return;
    lastLeafRefreshAtRef.current.set(source.id, now);
    void fetchLeafDisplayMetadataRefresh(url).then((patch) => {
      if (!patch || Object.keys(patch).length === 0) return;
      setDisplayMetaPatch((prev) => ({ ...prev, ...patch }));
    });
  }, [showLeafLibraryChips, source.id, source.url]);

  const useExplicitPlaylistArt = explicitArtUrl !== undefined;
  const cardCover = useExplicitPlaylistArt ? explicitArtUrl : source.cover;
  const effectiveViews = libraryCardEffectiveViewCount(source);
  const leafMetaStrip = showLeafLibraryChips ? <LeafUrlMetadataStrip source={sourceForLeafDisplay} /> : null;
  const listStripModel = kindBadge === "LIST" ? getLibraryListContainerMetaStripModel(source) : null;
  const listContainerStrip = listStripModel ? <ListContainerMetadataStrip source={source} /> : null;
  const leafArtProviderCorner = showLeafLibraryChips ? (
    <SourceLogo type={source.type} origin={source.origin} size="sm" preferStreamProviderGlyph />
  ) : null;

  const hasPersistedGenre = Boolean(typeof source.genre === "string" && source.genre.trim());
  const showMetaRow = libraryCardShouldShowMetaRow(source, durationSec, Boolean(cardCover));

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

  const titleAsideNode = (
    <>
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
      {showLeafLibraryChips ? null : <SourceLogo type={source.type} origin={source.origin} size="md" />}
    </>
  );

  const sourceActions = (
    <LibrarySourceItemActions
      source={source}
      onPlay={() => {
        scheduleLeafDisplayMetadataRefresh();
        playSourceFn(source);
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
    />
  );

  const isDiskLocalPlaylist = source.origin === "source" && source.source?.type === "local_playlist";

  return (
    <>
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onPlaylistEntityOpen ? handleCardClickForOpen : undefined}
      onDoubleClick={onPlaylistEntityPlay ? handleCardDoubleClickPlay : undefined}
      className={`library-source-card group flex h-full min-w-0 w-full flex-col overflow-hidden rounded-2xl backdrop-blur-md transition-transform duration-200 ease-out hover:-translate-y-0.5 ${
        showLeafLibraryChips ? "library-source-card-leaf" : ""
      } ${active ? "library-playing-active" : ""} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }${isDiskLocalPlaylist ? " library-source-card--local-disk" : ""}`}
    >
      {useBranchTileShell ? (
        <BranchLibraryBrowseCard
          interaction="embeddedDiv"
          item={branchListItem!}
          selected={active}
          className={`min-h-0 flex-1 flex flex-col${isDiskLocalPlaylist ? " library-browse-card--local-disk" : ""}`}
          titleAside={titleAsideNode}
          originBadgeClassName={libraryKindBadgeArtClass(kindBadge)}
          artTopRightSlot={leafArtProviderCorner ?? undefined}
          surfaceMetaSlot={
            kindBadge === "LIST" && listContainerStrip ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-col gap-2">{listContainerStrip}</div>
              </div>
            ) : showLeafLibraryChips ? (
              <div className="flex flex-col gap-1.5">
                <p className="sb-lbc-meta text-[10px] font-semibold uppercase tracking-[0.12em]">
                  {branchLibraryItemMetaLine(branchListItem!)}
                </p>
                {leafMetaStrip ? <div className="flex flex-col gap-2">{leafMetaStrip}</div> : null}
              </div>
            ) : undefined
          }
        >
          {sourceActions}
        </BranchLibraryBrowseCard>
      ) : (
      <LibraryBrowseCardSurface
        as="div"
        className="min-h-0 flex-1 flex flex-col"
        artSlot={
          <div className="library-card-art-bg relative aspect-[4/3] w-full min-h-0 shrink-0 overflow-hidden">
            <span
              className={`pointer-events-none absolute left-2 top-2 z-10 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm ${libraryKindBadgeArtClass(kindBadge)}`}
              aria-hidden
            >
              {badgeText}
            </span>
            {leafArtProviderCorner ? (
              <div className="absolute right-2 top-2 z-10">{leafArtProviderCorner}</div>
            ) : null}
            {cardCover ? (
              <>
                <HydrationSafeImage src={cardCover} alt="" className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]" />
                <div className="library-card-art-overlay pointer-events-none absolute inset-0" aria-hidden />
                {source.origin === "radio" && (
                  <span className="library-live-badge absolute right-2 top-2 rounded-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-lg backdrop-blur-sm">
                    {t.live}
                  </span>
                )}
                {!showLeafLibraryChips && durationSec > 0 && (
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
                {!showLeafLibraryChips && durationSec > 0 && (
                  <span className="library-pill-overlay library-pill-overlay-soft absolute bottom-2 right-2 rounded-md px-2 py-0.5 text-[10px] font-medium tabular-nums backdrop-blur-md">
                    {formatDuration(durationSec)}
                  </span>
                )}
              </div>
            )}
            {!cardCover && !useExplicitPlaylistArt && (
              <div className="relative h-full w-full">
                <TrackMediaPlaceholder chip={provenanceChip} className="h-full w-full" showCornerBadge={false} />
                {!showLeafLibraryChips && durationSec > 0 && (
                  <span className="library-pill-overlay library-pill-overlay-soft absolute bottom-2 right-2 rounded-md px-2 py-0.5 text-[10px] font-medium tabular-nums backdrop-blur-md">
                    {formatDuration(durationSec)}
                  </span>
                )}
              </div>
            )}
            {showLeafLibraryChips ? (
              <span className="pointer-events-none absolute bottom-2 left-2 z-[11]">
                <CompactSourceBadge chip={provenanceChip} />
              </span>
            ) : null}
          </div>
        }
        title={source.title}
        metaLine=""
        metaSlot={(() => {
          const genreWithChips =
            showLeafLibraryChips && hasPersistedGenre ? (
              <p className="library-card-meta text-[10px] font-semibold uppercase tracking-[0.14em]">
                {libraryCardDisplayGenre(source)}
              </p>
            ) : null;

          const legacyMeta =
            !showLeafLibraryChips &&
            kindBadge !== "LIST" &&
            kindBadge !== "RADIO" &&
            showMetaRow ? (
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <p className="library-card-meta text-[10px] font-semibold uppercase tracking-[0.14em]">
                  {libraryCardDisplayGenre(source)}
                </p>
                <div className="library-card-meta ml-auto flex items-center gap-2 text-[11px] tabular-nums">
                  {effectiveViews != null && (
                    <span>
                      {formatViewCount(effectiveViews)} {t.views}
                    </span>
                  )}
                  {effectiveViews != null && durationSec > 0 && !cardCover && (
                    <span className="library-card-meta-muted">•</span>
                  )}
                  {durationSec > 0 && !cardCover && <span>{formatDuration(durationSec)}</span>}
                </div>
              </div>
            ) : null;

          const chipRow = showLeafLibraryChips ? leafMetaStrip : listContainerStrip;

          if (!genreWithChips && !legacyMeta && !chipRow) return undefined;
          return (
            <div className="flex flex-col gap-1.5">
              {genreWithChips}
              {legacyMeta}
              {chipRow}
            </div>
          );
        })()}
        titleAside={titleAsideNode}
      >
        {sourceActions}
      </LibraryBrowseCardSurface>
      )}
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
