"use client";

import { useState, useCallback, useMemo, useEffect, useRef, startTransition, type DragEvent, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { useLocale, useTranslations } from "@/lib/locale-context";
import { labels } from "@/lib/locale-context";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { RadioIcon } from "@/components/ui/radio-icon";
import { formatViewCount, formatDuration } from "@/lib/format-utils";
import { SourcesPlaybackProvider, useSourcesPlayback } from "@/lib/sources-playback-context";
import { usePlayback } from "@/lib/playback-provider";
import { useDevicePlayer } from "@/lib/device-player-context";
import { SourceCard, type LibraryItemDeleteContext } from "@/components/source-card-unified";
import { LibraryItemContextDeleteModal } from "@/components/library-item-context-delete-modal";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { LibrarySourceItemActions } from "@/components/library-source-item-actions";
import { LibraryInputArea } from "@/components/library-input-area";
import { GuestLinkButton, guestLinkLedButtonClass } from "@/components/guest-link-button";
import { getFavorites, addFavorite as addFav, removeFavorite as removeFav } from "@/lib/favorites-store";
import { fetchUnifiedSourcesWithFallback, savePlaylistToLocal, saveRadioToLocal, removePlaylistFromLocal, removeRadioFromLocal } from "@/lib/unified-sources-client";
import { getPlaylistTracks, type Playlist } from "@/lib/playlist-types";
import { canonicalYouTubeWatchUrlForPlayback } from "@/lib/playlist-utils";
import { detectProvider } from "@/lib/player-utils";
import {
  expandPlaylistEntityToItems,
  playlistLeafTrackIndexForQueueItem,
  resolveSyncbizPlaylistPlayQueue,
  SYNC_PLAYLIST_ASSIGNMENTS_STORAGE_KEY,
  visibleItemsForSyncbizPlaylistGrid,
} from "@/lib/syncbiz-playlist-queue";
import {
  classifyLibraryEntityContract,
  libraryCardDisplayGenre,
  libraryCardEffectiveViewCount,
  libraryCardShouldShowMetaRow,
  type LibraryCollectionSubtype,
  type UnifiedSource,
  unifiedFoundationHints,
} from "@/lib/source-types";
import {
  LIBRARY_SECTION_ORDER,
  partitionSourcesByLibrarySection,
  type LibrarySectionId,
} from "@/lib/library-grouping";
import { librarySectionLabel } from "@/lib/library-section-i18n";
import { inferDaypartLabel, resolveDaypartCollectionSources } from "@/lib/daypart-collection";
import { ScheduleBlockModal, type ScheduleModalInitialContext } from "@/components/schedule-block-modal";
import { useLibraryTheme } from "@/lib/library-theme-context";
import {
  LIBRARY_PLAYLIST_TILE_SIDE_ACTION_BTN_CLASS,
  LIBRARY_PLAYLIST_TILE_SIDE_ACTION_CLUSTER_CLASS,
  LIBRARY_SIDE_ACTION_ICON_BTN_CLASS,
} from "@/lib/library-side-action-styles";

/** Left-rail section headers (Ready Playlists / Playlist Tiles) — shared visual language for shell actions. */
const LIBRARY_RAIL_SHELL_ACTION_BTN_CLASS =
  "library-nav-link inline-flex shrink-0 items-center rounded-lg px-2.5 py-1 text-[11px] font-medium leading-none tracking-wide transition-colors";

/**
 * Library grouping product note (implemented in `lib/library-grouping.ts`, not UI): mix/set auto-classification
 * treats duration >= 20 minutes as a strong candidate; 15–20 minutes is hint-only and requires supporting signals.
 */

type ViewMode = "grid" | "list";

type LibraryViewId =
  | "all_library"
  | "recently_added"
  | "playlists"
  | "external_playlists"
  | "single_tracks"
  | "favorites"
  | "sources"
  | "saved_sources";
type CollectionGroupId = "curated_masters" | "dayparts_hours" | "client_specific";
type LibrarySelection =
  | { type: "library_view"; id: LibraryViewId }
  | { type: "collection_group"; id: CollectionGroupId }
  | { type: "collection_container"; subtype: LibraryCollectionSubtype; key: string }
  | { type: "source_channel"; key: string }
  | { type: "single_tracks_view" };

function isExternalPlaylistExpandedTrack(selection: LibrarySelection, source: UnifiedSource): boolean {
  return (
    selection.type === "collection_container" &&
    selection.subtype === "external_playlist" &&
    source.origin === "source" &&
    source.id.includes(":track:")
  );
}

function isExpandedPlaylistSyntheticRow(item: UnifiedSource): boolean {
  return item.id.includes(":track:");
}

/** Match playback URL for expanded rows vs unified src-* items (YouTube variants). */
function playbackUrlsMatchUnifiedLibrary(a: string, b: string, type: UnifiedSource["type"]): boolean {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (!x || !y) return false;
  if (type === "youtube") {
    return (
      canonicalYouTubeWatchUrlForPlayback(x).trim().toLowerCase() ===
      canonicalYouTubeWatchUrlForPlayback(y).trim().toLowerCase()
    );
  }
  return x.toLowerCase() === y.toLowerCase();
}

/** Match expanded row vs DB source URL using either row's or library row's provider type (types can disagree on imports). */
function playbackUrlsMatchLibraryCrossType(
  urlA: string,
  typeA: UnifiedSource["type"],
  urlB: string,
  typeB: UnifiedSource["type"]
): boolean {
  return (
    playbackUrlsMatchUnifiedLibrary(urlA, urlB, typeA) ||
    playbackUrlsMatchUnifiedLibrary(urlA, urlB, typeB)
  );
}

function catalogMediaTypeForAddToLibraryPayload(source: UnifiedSource): string {
  const u = (source.url ?? "").trim();
  const p = detectProvider(u);
  if (p === "youtube") return "youtube";
  if (p === "soundcloud") return "soundcloud";
  if (u.toLowerCase().includes("spotify")) return "spotify";
  return source.type;
}

function canDeleteFromLibrary(item: UnifiedSource): boolean {
  return (
    (item.origin === "playlist" && !!item.playlist) ||
    (item.origin === "source" && !!item.source) ||
    (item.origin === "radio" && !!item.radio)
  );
}

function findMainLibrarySourceForExpandedTrack(item: UnifiedSource, all: UnifiedSource[]): UnifiedSource | null {
  if (!isExpandedPlaylistSyntheticRow(item)) return null;
  for (const s of all) {
    if (s.origin !== "source" || !s.source) continue;
    if (playbackUrlsMatchLibraryCrossType(item.url, item.type, s.url, s.type)) return s;
  }
  return null;
}

function libraryRowEligibleForLibraryDelete(item: UnifiedSource, all: UnifiedSource[]): boolean {
  return canDeleteFromLibrary(item) || findMainLibrarySourceForExpandedTrack(item, all) != null;
}

type CollectionContainer = {
  key: string;
  label: string;
  subtype: LibraryCollectionSubtype;
  itemCount: number;
  meta?: string;
  cover?: string | null;
};

type SourceChannelContainer = {
  key: string;
  label: string;
  platformLabel: string;
  itemCount: number;
  cover?: string | null;
};

type PlaylistTile = {
  key: string;
  label: string;
};
type PlaylistContainerPayload = {
  subtype: LibraryCollectionSubtype;
  key: string;
  label?: string;
};

type Props = {
  initialSources: UnifiedSource[];
  pageTitle?: string;
  pageSubtitle?: string;
};

export function SourcesManager({ initialSources, pageTitle, pageSubtitle }: Props) {
  const [effectiveSources, setEffectiveSources] = useState<UnifiedSource[]>(initialSources);
  const prevIdsRef = useRef<string>("");

  const refetchSources = useCallback(() => {
    fetchUnifiedSourcesWithFallback().then((items) => {
      const filtered = items.filter((s) => s.origin !== "radio");
      prevIdsRef.current = filtered.map((s) => s.id).join(",");
      setEffectiveSources(filtered);
    });
  }, []);

  useEffect(() => {
    if (initialSources.length > 0) {
      const ids = initialSources.map((s) => s.id).join(",");
      if (ids === prevIdsRef.current) return;
      prevIdsRef.current = ids;
      setEffectiveSources(initialSources);
    } else {
      refetchSources();
    }
  }, [initialSources, refetchSources]);

  useEffect(() => {
    const handler = () => refetchSources();
    window.addEventListener("library-updated", handler);
    return () => window.removeEventListener("library-updated", handler);
  }, [refetchSources]);

  return (
    <SourcesPlaybackProvider sources={effectiveSources}>
      <SourcesManagerInner pageTitle={pageTitle} pageSubtitle={pageSubtitle} />
    </SourcesPlaybackProvider>
  );
}

function useFavoritesState() {
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  useEffect(() => {
    setFavoriteIds(getFavorites());
  }, []);
  const addFavorite = useCallback((id: string) => {
    addFav(id);
    setFavoriteIds(getFavorites());
  }, []);
  const removeFavorite = useCallback((id: string) => {
    removeFav(id);
    setFavoriteIds(getFavorites());
  }, []);
  const toggleFavorite = useCallback((id: string) => {
    const ids = getFavorites();
    if (ids.includes(id)) {
      removeFav(id);
    } else {
      addFav(id);
    }
    setFavoriteIds(getFavorites());
  }, []);
  return { favoriteIds, addFavorite, removeFavorite, toggleFavorite };
}

function useFollowedSourcesState() {
  const STORAGE_KEY = "syncbiz-followed-source-keys";
  const [followedSourceKeys, setFollowedSourceKeys] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      setFollowedSourceKeys(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setFollowedSourceKeys([]);
    }
  }, []);
  const toggleFollowedSource = useCallback((key: string) => {
    setFollowedSourceKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return { followedSourceKeys, toggleFollowedSource };
}

function inferClientLabel(source: UnifiedSource): string {
  const branchId = source.playlist?.branchId ?? source.source?.branchId ?? source.radio?.branchId;
  const tenantId = source.playlist?.tenantId ?? source.radio?.tenantId;
  if (branchId) return `Branch ${branchId}`;
  if (tenantId) return `Tenant ${tenantId}`;
  return "Default Client";
}

function inferCuratedProfile(source: UnifiedSource): {
  style: string;
  mood: string;
  energy: "Low" | "Medium" | "High";
  useCase: string;
} {
  const text = `${source.title} ${source.genre ?? ""}`.toLowerCase();
  const style =
    /mizrahi/i.test(text) ? "Mizrahi" :
    /israeli|hebrew/i.test(text) ? "Israeli" :
    /mediterranean/i.test(text) ? "Mediterranean" :
    /greek|taverna/i.test(text) ? "Greek" :
    /house/i.test(text) ? "House" :
    /rock/i.test(text) ? "Rock" :
    (source.genre?.trim() || "General");
  const mood =
    /(celebration|hafla|party|dance)/i.test(text) ? "Celebratory" :
    /(calm|slow|soft|spa|chill)/i.test(text) ? "Calm" :
    /(lounge|ambient)/i.test(text) ? "Lounge" :
    /(upbeat|happy|uplift)/i.test(text) ? "Upbeat" :
    "Vibes";
  const energy: "Low" | "Medium" | "High" =
    /(high energy|dance|hafla|party|rock|upbeat)/i.test(text) ? "High" :
    /(calm|slow|spa|ambient|lounge)/i.test(text) ? "Low" :
    "Medium";
  const useCase =
    /(restaurant|dinner|evening)/i.test(text) ? "Restaurant Evening" :
    /(spa|wellness|relax)/i.test(text) ? "Spa Calm" :
    /(morning|sunrise|breakfast)/i.test(text) ? "Morning Chill" :
    /(celebration|hafla|event|wedding)/i.test(text) ? "Celebration / Hafla" :
    "General Service";
  return { style, mood, energy, useCase };
}

function buildHumanCuratedLabel(profile: {
  style: string;
  mood: string;
  energy: "Low" | "Medium" | "High";
  useCase: string;
}): string {
  if (profile.useCase !== "General Service") return profile.useCase;
  if (profile.mood === "Vibes") {
    if (profile.energy === "High") return `${profile.style} Energy`;
    if (profile.energy === "Low") return `${profile.style} Calm`;
    return `${profile.style} Lounge`;
  }
  return `${profile.style} ${profile.mood}`;
}

function normalizeCollectionLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "_");
}

function getCuratedCollectionKey(source: UnifiedSource): string {
  const curated = inferCuratedProfile(source);
  const curatedLabel = buildHumanCuratedLabel(curated);
  return `curated:${normalizeCollectionLabel(curatedLabel)}`;
}

const FIXED_DAYPART_PADS: Array<{ label: "Morning" | "Afternoon" | "Evening" | "Night"; key: string; tone: string }> = [
  { label: "Morning", key: "daypart:morning", tone: "from-amber-500/35 to-orange-500/20 border-amber-300/45" },
  { label: "Afternoon", key: "daypart:afternoon", tone: "from-sky-500/35 to-cyan-500/20 border-sky-300/45" },
  { label: "Evening", key: "daypart:evening", tone: "from-violet-500/35 to-fuchsia-500/20 border-violet-300/45" },
  { label: "Night", key: "daypart:late_night", tone: "from-indigo-500/35 to-slate-700/35 border-indigo-300/45" },
];
const PLAYLIST_TILES_STORAGE_KEY = "syncbiz-custom-playlist-tiles";
const PLAYLIST_ASSIGNMENTS_STORAGE_KEY = SYNC_PLAYLIST_ASSIGNMENTS_STORAGE_KEY;
const DAYPART_PLAYLIST_ASSIGNMENTS_STORAGE_KEY = "syncbiz-daypart-playlist-assignments";

function isLikelyMixSet(source: UnifiedSource): boolean {
  if (source.contentNodeKind === "mix_set") return true;
  const title = (source.title ?? "").toLowerCase();
  if (/\b(mix|set|session)\b/.test(title) || /\blive\s+set\b/.test(title)) return true;
  const duration = source.playlist?.durationSeconds ?? 0;
  return duration >= 20 * 60;
}

function getSourceCreatedAtMs(source: UnifiedSource): number {
  const raw = source.playlist?.createdAt ?? source.radio?.createdAt;
  if (!raw) return 0;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function inferSourceChannel(source: UnifiedSource): SourceChannelContainer {
  const title = source.title?.trim() || "Unknown Source";
  const split = title.includes(" - ") ? title.split(" - ")[0].trim() : title;
  const label = split.length > 2 ? split : title;
  const platformLabel =
    source.type === "youtube"
      ? "YouTube"
      : source.type === "soundcloud"
        ? "SoundCloud"
        : source.type === "spotify"
          ? "Spotify"
          : source.origin === "radio"
            ? "Radio"
            : "Source";
  const key = `source:${platformLabel.toLowerCase()}:${label.toLowerCase().replace(/\s+/g, "_")}`;
  return { key, label, platformLabel, itemCount: 1, cover: source.cover };
}

/** Matches playlist drop targets that prefer `syncbiz-queue-source-ids`, with single-item fallbacks for other consumers. */
function setLibrarySourcesPlaylistDragPayload(e: DragEvent, sources: UnifiedSource[]) {
  if (sources.length === 0) {
    e.preventDefault();
    return;
  }
  const ids = sources.map((s) => s.id);
  e.dataTransfer.setData("application/syncbiz-queue-source-ids", JSON.stringify(ids));
  e.dataTransfer.setData("application/syncbiz-queue-sources", JSON.stringify(sources));
  if (sources.length === 1) {
    e.dataTransfer.setData("application/syncbiz-source-id", sources[0].id);
    e.dataTransfer.setData("application/syncbiz-source-json", JSON.stringify(sources[0]));
  }
  e.dataTransfer.effectAllowed = "copyMove";
}

function firstUsableCoverUrl(c: string | null | undefined): string | null {
  const t = c?.trim();
  return t ? t : null;
}

function isUserSyncbizPlaylistSource(source: UnifiedSource): boolean {
  if (source.origin !== "playlist") return false;
  const contract = classifyLibraryEntityContract(source);
  return contract.entityKind === "collection" && contract.collectionSubtype === "syncbiz_playlist";
}

/** Cover for user playlists: playlist/UnifiedSource art, then first track art, then first assigned library item with art. */
function deriveSyncbizPlaylistCover(
  playlistUnified: UnifiedSource,
  assignedIds: string[],
  displayById: Map<string, UnifiedSource>
): string | null {
  const direct = firstUsableCoverUrl(playlistUnified.cover);
  if (direct) return direct;
  if (playlistUnified.playlist) {
    for (const track of getPlaylistTracks(playlistUnified.playlist)) {
      const tc = firstUsableCoverUrl(track.cover ?? null);
      if (tc) return tc;
    }
  }
  for (const id of assignedIds) {
    const item = displayById.get(id);
    const ic = firstUsableCoverUrl(item?.cover);
    if (ic) return ic;
  }
  return null;
}

/** Real playlist entities (user or import) for open/play/drag behavior. */
function getPlaylistEntitySubtypeKey(source: UnifiedSource): { subtype: LibraryCollectionSubtype; key: string } | null {
  const contract = classifyLibraryEntityContract(source);
  if (contract.entityKind === "collection" && contract.collectionSubtype === "syncbiz_playlist" && source.origin === "playlist") {
    return { subtype: "syncbiz_playlist", key: `syncbiz:${source.id}` };
  }
  if (contract.entityKind === "collection" && contract.collectionSubtype === "external_playlist") {
    return { subtype: "external_playlist", key: `external:${source.id}` };
  }
  return null;
}

function makeCollectionContainers(sources: UnifiedSource[]) {
  const curatedMap = new Map<string, CollectionContainer>();
  const daypartMap = new Map<string, CollectionContainer>();
  const clientMap = new Map<string, CollectionContainer>();
  const externalMap = new Map<string, CollectionContainer>();
  const sourceChannelMap = new Map<string, SourceChannelContainer>();

  for (const source of sources) {
    const contract = classifyLibraryEntityContract(source);
    const curated = inferCuratedProfile(source);
    const curatedLabel = buildHumanCuratedLabel(curated);
    const curatedKey = `curated:${normalizeCollectionLabel(curatedLabel)}`;
    const curatedPrev = curatedMap.get(curatedKey);
    curatedMap.set(curatedKey, {
      key: curatedKey,
      label: curatedLabel,
      subtype: "genre_collection",
      itemCount: (curatedPrev?.itemCount ?? 0) + 1,
      meta: curated.useCase !== "General Service" ? curated.useCase : undefined,
      cover: curatedPrev?.cover ?? source.cover,
    });

    const daypart = inferDaypartLabel(source);
    const daypartKey = `daypart:${daypart.toLowerCase().replace(/\s+/g, "_")}`;
    const daypartPrev = daypartMap.get(daypartKey);
    daypartMap.set(daypartKey, {
      key: daypartKey,
      label: daypart,
      subtype: "daypart_collection",
      itemCount: (daypartPrev?.itemCount ?? 0) + 1,
      cover: daypartPrev?.cover ?? source.cover,
    });

    const client = inferClientLabel(source);
    const clientKey = `client:${client.toLowerCase().replace(/\s+/g, "_")}`;
    const clientPrev = clientMap.get(clientKey);
    clientMap.set(clientKey, {
      key: clientKey,
      label: client,
      subtype: "client_collection",
      itemCount: (clientPrev?.itemCount ?? 0) + 1,
      cover: clientPrev?.cover ?? source.cover,
    });

    if (contract.entityKind === "collection" && contract.collectionSubtype === "external_playlist") {
      const externalKey = `external:${source.id}`;
      externalMap.set(externalKey, {
        key: externalKey,
        label: source.title,
        subtype: "external_playlist",
        itemCount: 1,
        cover: source.cover,
      });
    }

    const sourceChannel = inferSourceChannel(source);
    const prevSourceChannel = sourceChannelMap.get(sourceChannel.key);
    sourceChannelMap.set(sourceChannel.key, {
      ...sourceChannel,
      itemCount: (prevSourceChannel?.itemCount ?? 0) + 1,
      cover: prevSourceChannel?.cover ?? sourceChannel.cover,
    });
  }

  const byLabel = (a: CollectionContainer, b: CollectionContainer) => a.label.localeCompare(b.label);
  return {
    curated: [...curatedMap.values()].sort((a, b) => b.itemCount - a.itemCount || a.label.localeCompare(b.label)),
    dayparts: [...daypartMap.values()].sort(byLabel),
    clients: [...clientMap.values()].sort(byLabel),
    external: [...externalMap.values()].sort(byLabel),
    sources: [...sourceChannelMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function SourcesManagerInner({ pageTitle, pageSubtitle }: { pageTitle?: string; pageSubtitle?: string }) {
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const { t } = useTranslations();
  const { libraryTheme } = useLibraryTheme();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [genreFilter, setGenreFilter] = useState("");
  const [selection, setSelection] = useState<LibrarySelection>({ type: "library_view", id: "all_library" });
  const [customPlaylists, setCustomPlaylists] = useState<PlaylistTile[]>([]);
  const [playlistItemAssignments, setPlaylistItemAssignments] = useState<Record<string, string[]>>({});
  const [daypartPlaylistAssignments, setDaypartPlaylistAssignments] = useState<Record<string, string>>({});
  const [playlistContainerDeleteKey, setPlaylistContainerDeleteKey] = useState<string | null>(null);
  const [playlistContainerDeleting, setPlaylistContainerDeleting] = useState(false);
  const [readyCollectionModalOpen, setReadyCollectionModalOpen] = useState(false);
  const [externalPlaylistDeleteKey, setExternalPlaylistDeleteKey] = useState<string | null>(null);
  const [externalPlaylistDeleting, setExternalPlaylistDeleting] = useState(false);
  const [tileSlotModal, setTileSlotModal] = useState<
    | null
    | { key: string; variant: "clearAssignment" | "removeCustomTile" | "empty" }
  >(null);
  const [tileSlotActionLoading, setTileSlotActionLoading] = useState(false);
  const [playlistTileScheduleModal, setPlaylistTileScheduleModal] = useState<ScheduleModalInitialContext | null>(null);
  /** Inline error for Add to Library (Ready Playlist decomposed rows); cleared on success or next attempt. */
  const [catalogAddError, setCatalogAddError] = useState<string | null>(null);
  const sourceBackSelectionRef = useRef<LibrarySelection>({ type: "library_view", id: "sources" });
  const { favoriteIds, toggleFavorite } = useFavoritesState();
  const { followedSourceKeys, toggleFollowedSource } = useFollowedSourcesState();
  const playlistAutoLoaded = useRef(false);
  const userPlaylistRailOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { sources, setSources } = useSourcesPlayback();
  const { setQueue, playSource, stop, pause } = usePlayback();
  const deviceCtx = useDevicePlayer();
  const isDevicePlayer = deviceCtx?.isBranchConnected ?? false;
  const isMaster = deviceCtx?.deviceMode === "MASTER";
  const playSourceOverride = isDevicePlayer && !isMaster ? deviceCtx?.playSourceOrSend : undefined;
  const stopOverride = isDevicePlayer && !isMaster ? deviceCtx?.stopOrSend : undefined;
  const pauseOverride = isDevicePlayer && !isMaster ? deviceCtx?.pauseOrSend : undefined;
  const masterState = deviceCtx?.masterState;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PLAYLIST_TILES_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as PlaylistTile[]) : [];
      setCustomPlaylists(Array.isArray(parsed) ? parsed : []);
    } catch {
      setCustomPlaylists([]);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PLAYLIST_ASSIGNMENTS_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
      setPlaylistItemAssignments(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setPlaylistItemAssignments({});
    }
    try {
      const raw = localStorage.getItem(DAYPART_PLAYLIST_ASSIGNMENTS_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      setDaypartPlaylistAssignments(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setDaypartPlaylistAssignments({});
    }
  }, []);

  useEffect(() => {
    const playlistId = searchParams.get("playlist");
    if (!playlistId || sources.length === 0 || playlistAutoLoaded.current) return;
    const source = sources.find(
      (s) => s.id === playlistId || (s.playlist && s.playlist.id === playlistId)
    );
    if (source) {
      playlistAutoLoaded.current = true;
      playSource(source);
    }
  }, [searchParams, sources, playSource]);

  const genres = useMemo(
    () => [...new Set(sources.map((s) => s.genre).filter(Boolean))].sort(),
    [sources]
  );

  const filtered = useMemo(() => {
    if (!genreFilter) return sources;
    return sources.filter((s) => s.genre?.toLowerCase() === genreFilter.toLowerCase());
  }, [sources, genreFilter]);

  const displaySources = filtered;
  const displaySourcesById = useMemo(
    () => new Map(displaySources.map((s) => [s.id, s] as const)),
    [displaySources]
  );
  const containers = useMemo(() => makeCollectionContainers(displaySources), [displaySources]);

  const visibleSources = useMemo(() => {
    if (selection.type === "single_tracks_view") {
      return displaySources.filter((s) => {
        const contract = classifyLibraryEntityContract(s);
        return contract.entityKind === "item" && contract.itemSubtype === "single_track";
      });
    }
    if (selection.type === "library_view") {
      if (selection.id === "all_library") return displaySources;
      if (selection.id === "recently_added") return displaySources.slice(0, 24);
      if (selection.id === "playlists") {
        return displaySources.filter((s) => s.origin === "playlist");
      }
      if (selection.id === "favorites") return displaySources.filter((s) => favoriteIds.includes(s.id));
      if (selection.id === "single_tracks") {
        return displaySources.filter((s) => {
          const contract = classifyLibraryEntityContract(s);
          return contract.entityKind === "item" && contract.itemSubtype === "single_track";
        });
      }
      if (selection.id === "external_playlists") {
        return displaySources.filter((s) => {
          const contract = classifyLibraryEntityContract(s);
          return contract.entityKind === "collection" && contract.collectionSubtype === "external_playlist";
        });
      }
      if (selection.id === "sources") {
        return displaySources.filter((s) => ["youtube", "soundcloud", "spotify"].includes(s.type));
      }
      if (selection.id === "saved_sources") {
        return displaySources.filter((s) => followedSourceKeys.includes(inferSourceChannel(s).key));
      }
    }
    if (selection.type === "source_channel") {
      return displaySources.filter((s) => inferSourceChannel(s).key === selection.key);
    }
    if (selection.type === "collection_container") {
      if (selection.subtype === "genre_collection") {
        const inferred = displaySources.filter((s) => selection.key === getCuratedCollectionKey(s));
        const assignedIds = playlistItemAssignments[selection.key] ?? [];
        const assignedItems = displaySources.filter((s) => assignedIds.includes(s.id));
        const map = new Map<string, UnifiedSource>();
        for (const s of [...inferred, ...assignedItems]) map.set(s.id, s);
        return [...map.values()];
      }
      if (selection.subtype === "daypart_collection") {
        const inferred = selection.key.startsWith("customplaylist:")
          ? []
          : displaySources.filter((s) => `daypart:${inferDaypartLabel(s).toLowerCase().replace(/\s+/g, "_")}` === selection.key);
        const assignedPlaylistKey = daypartPlaylistAssignments[selection.key];
        const assigned = assignedPlaylistKey
          ? displaySources.filter((s) => s.origin === "playlist" && `syncbiz:${s.id}` === assignedPlaylistKey)
          : [];
        const assignedItemIds = playlistItemAssignments[selection.key] ?? [];
        const assignedItems = displaySources.filter((s) => assignedItemIds.includes(s.id));
        const map = new Map<string, UnifiedSource>();
        for (const s of [...assigned, ...assignedItems, ...inferred]) map.set(s.id, s);
        return [...map.values()];
      }
      if (selection.subtype === "client_collection") {
        const inferred = displaySources.filter(
          (s) => `client:${inferClientLabel(s).toLowerCase().replace(/\s+/g, "_")}` === selection.key
        );
        const assignedIds = playlistItemAssignments[selection.key] ?? [];
        const assignedItems = displaySources.filter((s) => assignedIds.includes(s.id));
        const map = new Map<string, UnifiedSource>();
        for (const s of [...inferred, ...assignedItems]) map.set(s.id, s);
        return [...map.values()];
      }
      if (selection.subtype === "external_playlist") {
        const source = displaySources.find((s) => `external:${s.id}` === selection.key);
        if (!source) return [];
        const expanded = expandPlaylistEntityToItems(source);
        return expanded.length > 0 ? expanded : [source];
      }
      if (selection.subtype === "syncbiz_playlist") {
        return visibleItemsForSyncbizPlaylistGrid(selection.key, displaySources, playlistItemAssignments);
      }
    }
    return displaySources;
  }, [selection, displaySources, favoriteIds, followedSourceKeys, playlistItemAssignments, daypartPlaylistAssignments]);

  const shouldDefaultExternalReadyPlaylistToList = useMemo(() => {
    if (selection.type !== "collection_container" || selection.subtype !== "external_playlist") return false;
    return visibleSources.some(
      (s) =>
        isExpandedPlaylistSyntheticRow(s) &&
        findMainLibrarySourceForExpandedTrack(s, displaySources) == null
    );
  }, [selection, visibleSources, displaySources]);

  useEffect(() => {
    if (!shouldDefaultExternalReadyPlaylistToList) return;
    setViewMode("list");
  }, [
    shouldDefaultExternalReadyPlaylistToList,
    selection.type === "collection_container" && selection.subtype === "external_playlist" ? selection.key : null,
  ]);

  const sectionBuckets = useMemo(
    () => partitionSourcesByLibrarySection(visibleSources),
    [visibleSources]
  );

  const selectedCollectionCards = useMemo(() => {
    if (selection.type === "collection_group") {
      if (selection.id === "curated_masters") {
        return containers.curated;
      }
      if (selection.id === "dayparts_hours") return containers.dayparts;
      if (selection.id === "client_specific") return containers.clients;
    }
    if (selection.type === "library_view" && selection.id === "external_playlists") {
      return containers.external;
    }
    return null;
  }, [selection, containers]);

  const userPlaylistContainers = useMemo(() => {
    return displaySources
      .filter((s) => {
        const contract = classifyLibraryEntityContract(s);
        return contract.entityKind === "collection" && contract.collectionSubtype === "syncbiz_playlist" && s.origin === "playlist";
      })
      .map((s) => {
        const key = `syncbiz:${s.id}`;
        const assignedIds = playlistItemAssignments[key] ?? [];
        return {
          key,
          label: s.title,
          subtype: "syncbiz_playlist" as const,
          itemCount: 1 + assignedIds.length,
          cover: deriveSyncbizPlaylistCover(s, assignedIds, displaySourcesById),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [displaySources, displaySourcesById, playlistItemAssignments]);

  const playlistSourceByKey = useMemo(() => {
    const map = new Map<string, UnifiedSource>();
    for (const s of displaySources) {
      if (s.origin === "playlist") map.set(`syncbiz:${s.id}`, s);
    }
    return map;
  }, [displaySources]);

  const selectedSourceCards = useMemo(() => {
    if (selection.type === "library_view" && selection.id === "sources") return containers.sources;
    if (selection.type === "library_view" && selection.id === "saved_sources") {
      return containers.sources.filter((s) => followedSourceKeys.includes(s.key));
    }
    return null;
  }, [selection, containers.sources, followedSourceKeys]);

  const collectionContextByKey = useMemo(() => {
    const map = new Map<string, { cover?: string | null; label: string; meta?: string; count: number }>();
    for (const c of [...containers.curated, ...containers.dayparts, ...containers.clients, ...containers.external]) {
      map.set(c.key, { cover: c.cover, label: c.label, meta: c.meta, count: c.itemCount });
    }
    for (const p of customPlaylists) {
      map.set(p.key, { label: p.label, meta: "Custom playlist", count: 0, cover: null });
    }
    for (const s of displaySources) {
      if (!isUserSyncbizPlaylistSource(s)) continue;
      const key = `syncbiz:${s.id}`;
      const assignedIds = playlistItemAssignments[key] ?? [];
      map.set(key, {
        label: s.title,
        meta: "Your playlist",
        count: 1 + assignedIds.length,
        cover: deriveSyncbizPlaylistCover(s, assignedIds, displaySourcesById),
      });
    }
    return map;
  }, [containers, customPlaylists, displaySources, displaySourcesById, playlistItemAssignments]);

  const collectionOpenContext = useMemo(() => {
    if (selection.type !== "collection_container") return null;
    const found = collectionContextByKey.get(selection.key);
    if (!found) return null;
    const count =
      selection.subtype === "syncbiz_playlist" ||
      selection.subtype === "genre_collection" ||
      selection.subtype === "client_collection"
        ? visibleSources.length
        : found.count;
    return {
      title: found.label,
      subtitle: found.meta ?? "Collection destination",
      count,
      cover: found.cover ?? null,
    };
  }, [selection, collectionContextByKey, visibleSources]);

  const sourceOpenContext = useMemo(() => {
    if (selection.type !== "source_channel") return null;
    const sourceCard = containers.sources.find((s) => s.key === selection.key);
    if (!sourceCard) return null;
    return sourceCard;
  }, [selection, containers.sources]);

  const sourceDetailItems = useMemo(() => {
    if (!sourceOpenContext) return null;
    const deduped = [...new Map(visibleSources.map((s) => [s.id, s])).values()];
    return [...deduped]
      .sort((a, b) => {
        const coverScore = Number(Boolean(b.cover)) - Number(Boolean(a.cover));
        if (coverScore !== 0) return coverScore;
        const recency = getSourceCreatedAtMs(b) - getSourceCreatedAtMs(a);
        if (recency !== 0) return recency;
        return (b.viewCount ?? 0) - (a.viewCount ?? 0);
      })
      .slice(0, 20);
  }, [sourceOpenContext, visibleSources]);

  const openSourceChannel = useCallback((key: string) => {
    setSelection((prev) => {
      if (prev.type !== "source_channel") {
        sourceBackSelectionRef.current = prev;
      }
      return { type: "source_channel", key };
    });
  }, []);

  const goBackFromSourceDetail = useCallback(() => {
    const prev = sourceBackSelectionRef.current;
    if (prev.type === "source_channel") {
      setSelection({ type: "library_view", id: "sources" });
      return;
    }
    setSelection(prev);
  }, []);

  const groupContext = useMemo(() => {
    if (selection.type !== "collection_group") return null;
    if (selection.id === "curated_masters") {
      return {
        title: "Ready Playlists",
        subtitle: "Curated ready-to-use music collections.",
        count: containers.curated.length,
      };
    }
    if (selection.id === "dayparts_hours") {
      return {
        title: "Business Moments",
        subtitle: "Daypart and moment collections for business programming.",
        count: containers.dayparts.length,
      };
    }
    return {
      title: "Client Collections",
      subtitle: "Collections grouped by client and branch context.",
      count: containers.clients.length,
    };
  }, [selection, containers]);

  const selectCollectionGroup = useCallback((id: CollectionGroupId) => {
    setSelection({ type: "collection_group", id });
  }, []);

  const resolveCollectionCardSources = useCallback(
    (container: CollectionContainer): UnifiedSource[] => {
      if (container.subtype === "genre_collection") {
        const inferred = displaySources.filter((s) => getCuratedCollectionKey(s) === container.key);
        const assignedIds = playlistItemAssignments[container.key] ?? [];
        const assignedItems = displaySources.filter((s) => assignedIds.includes(s.id));
        const map = new Map<string, UnifiedSource>();
        for (const s of [...inferred, ...assignedItems]) map.set(s.id, s);
        return [...map.values()];
      }
      if (container.subtype === "daypart_collection") {
        return displaySources.filter(
          (s) => `daypart:${inferDaypartLabel(s).toLowerCase().replace(/\s+/g, "_")}` === container.key
        );
      }
      if (container.subtype === "client_collection") {
        const inferred = displaySources.filter(
          (s) => `client:${inferClientLabel(s).toLowerCase().replace(/\s+/g, "_")}` === container.key
        );
        const assignedIds = playlistItemAssignments[container.key] ?? [];
        const assignedItems = displaySources.filter((s) => assignedIds.includes(s.id));
        const map = new Map<string, UnifiedSource>();
        for (const s of [...inferred, ...assignedItems]) map.set(s.id, s);
        return [...map.values()];
      }
      if (container.subtype === "external_playlist") {
        return displaySources.filter((s) => `external:${s.id}` === container.key);
      }
      return displaySources.filter((s) => s.origin === "playlist" && `syncbiz:${s.id}` === container.key);
    },
    [displaySources, playlistItemAssignments]
  );

  const resolveSourcesForSelection = useCallback(
    (subtype: LibraryCollectionSubtype, key: string): UnifiedSource[] => {
      if (subtype === "genre_collection") {
        const inferred = displaySources.filter((s) => getCuratedCollectionKey(s) === key);
        const assignedIds = playlistItemAssignments[key] ?? [];
        const assignedItems = displaySources.filter((s) => assignedIds.includes(s.id));
        const map = new Map<string, UnifiedSource>();
        for (const s of [...inferred, ...assignedItems]) map.set(s.id, s);
        return [...map.values()];
      }
      if (subtype === "daypart_collection") {
        return resolveDaypartCollectionSources(key, sources);
      }
      if (subtype === "client_collection") {
        const inferred = displaySources.filter(
          (s) => `client:${inferClientLabel(s).toLowerCase().replace(/\s+/g, "_")}` === key
        );
        const assignedIds = playlistItemAssignments[key] ?? [];
        const assignedItems = displaySources.filter((s) => assignedIds.includes(s.id));
        const map = new Map<string, UnifiedSource>();
        for (const s of [...inferred, ...assignedItems]) map.set(s.id, s);
        return [...map.values()];
      }
      if (subtype === "external_playlist") {
        const source = displaySources.find((s) => `external:${s.id}` === key);
        if (!source) return [];
        const expanded = expandPlaylistEntityToItems(source);
        return expanded.length > 0 ? expanded : [source];
      }
      if (subtype === "syncbiz_playlist") {
        return resolveSyncbizPlaylistPlayQueue(key, sources, playlistItemAssignments);
      }
      return [];
    },
    [sources, playlistItemAssignments]
  );

  const playCollectionSelection = useCallback(
    (subtype: LibraryCollectionSubtype, key: string) => {
      const queue = resolveSourcesForSelection(subtype, key);
      if (queue.length === 0) return;
      setQueue(queue, { force: true });
      const ti = playlistLeafTrackIndexForQueueItem(queue[0]);
      if (playSourceOverride) playSourceOverride(queue[0]);
      else playSource(queue[0], ti);
    },
    [resolveSourcesForSelection, setQueue, playSourceOverride, playSource]
  );

  const scheduleUserPlaylistRailOpen = useCallback((playlistKey: string) => {
    if (userPlaylistRailOpenTimerRef.current) clearTimeout(userPlaylistRailOpenTimerRef.current);
    userPlaylistRailOpenTimerRef.current = setTimeout(() => {
      userPlaylistRailOpenTimerRef.current = null;
      setSelection({ type: "collection_container", subtype: "syncbiz_playlist", key: playlistKey });
    }, 220);
  }, []);

  const buildPlaylistEntityDrag = useCallback(
    (source: UnifiedSource) => {
      const pe = getPlaylistEntitySubtypeKey(source);
      const sourcesForDrop = pe ? resolveSourcesForSelection(pe.subtype, pe.key) : [source];
      return { pe, sourcesForDrop };
    },
    [resolveSourcesForSelection]
  );

  const openDaypartTile = useCallback((daypartKey: string) => {
    const assignedPlaylistKey = daypartPlaylistAssignments[daypartKey];
    if (assignedPlaylistKey) {
      setSelection({ type: "collection_container", subtype: "syncbiz_playlist", key: assignedPlaylistKey });
      return;
    }
    setSelection({ type: "collection_container", subtype: "daypart_collection", key: daypartKey });
  }, [daypartPlaylistAssignments]);

  const extractDroppedSourceIds = useCallback((e: React.DragEvent): string[] => {
    const queueIdsJson = e.dataTransfer.getData("application/syncbiz-queue-source-ids");
    if (queueIdsJson) {
      try {
        const ids = JSON.parse(queueIdsJson) as string[];
        if (Array.isArray(ids)) return ids;
      } catch {}
    }
    const sourceJson = e.dataTransfer.getData("application/syncbiz-source-json");
    if (sourceJson) {
      try {
        const source = JSON.parse(sourceJson) as UnifiedSource;
        if (source?.id) return [source.id];
      } catch {}
    }
    const sourceId = e.dataTransfer.getData("application/syncbiz-source-id");
    if (sourceId) return [sourceId];
    return [];
  }, []);

  const extractDroppedPlaylistContainer = useCallback((e: React.DragEvent): PlaylistContainerPayload | null => {
    const playlistPayloadJson = e.dataTransfer.getData("application/syncbiz-playlist-container");
    if (playlistPayloadJson) {
      try {
        const payload = JSON.parse(playlistPayloadJson) as PlaylistContainerPayload;
        if (payload?.key && payload?.subtype) return payload;
      } catch {}
    }
    const sourceJson = e.dataTransfer.getData("application/syncbiz-source-json");
    if (sourceJson) {
      try {
        const source = JSON.parse(sourceJson) as UnifiedSource;
        if (source?.origin === "playlist") {
          return { subtype: "syncbiz_playlist", key: `syncbiz:${source.id}`, label: source.title };
        }
      } catch {}
    }
    return null;
  }, []);

  const assignItemsToPlaylist = useCallback((playlistKey: string, sourceIds: string[]) => {
    if (sourceIds.length === 0) return;
    setPlaylistItemAssignments((prev) => {
      const existing = prev[playlistKey] ?? [];
      const merged = Array.from(new Set([...existing, ...sourceIds]));
      const next = { ...prev, [playlistKey]: merged };
      localStorage.setItem(PLAYLIST_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const assignPlaylistToDaypart = useCallback((daypartKey: string, playlistKey: string) => {
    setDaypartPlaylistAssignments((prev) => {
      const next = { ...prev, [daypartKey]: playlistKey };
      localStorage.setItem(DAYPART_PLAYLIST_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleAdd = useCallback(
    (s: UnifiedSource) => {
      startTransition(() => {
        setSources((prev) => [s, ...prev]);
      });
      if (s.origin === "playlist" && s.playlist) savePlaylistToLocal(s.playlist);
      if (s.origin === "radio" && s.radio) saveRadioToLocal(s.radio);
    },
    [setSources]
  );

  const handleRemove = useCallback(
    (id: string, origin?: UnifiedSource["origin"]) => {
      setSources((prev) => prev.filter((s) => s.id !== id));
      if (origin === "playlist") removePlaylistFromLocal(id);
      if (origin === "radio") removeRadioFromLocal(id);
    },
    [setSources]
  );

  const handleCreatePlaylist = useCallback(async () => {
    const nameRaw = window.prompt("Playlist name");
    const name = (nameRaw ?? "").trim();
    if (!name) return;

    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        url: `local://user-playlist/${Date.now()}`,
        type: "local",
        genre: "Custom",
        cover: "",
      }),
    });
    if (!res.ok) return;

    const created = await res.json();
    const sourceType = created.type as UnifiedSource["type"];
    const unified: UnifiedSource = {
      id: `pl-${created.id}`,
      title: created.name,
      genre: created.genre || "Custom",
      cover: created.thumbnail || null,
      type: sourceType,
      url: created.url,
      origin: "playlist",
      playlist: created,
      ...unifiedFoundationHints("playlist", sourceType, created.url),
    };

    savePlaylistToLocal(created);
    setSources((prev) => [unified, ...prev]);
    setSelection({ type: "collection_container", subtype: "syncbiz_playlist", key: `syncbiz:${unified.id}` });
  }, [savePlaylistToLocal, setSelection, setSources]);

  const handleAddPlaylistTile = useCallback(() => {
    const raw = window.prompt("Playlist name");
    const label = (raw ?? "").trim();
    if (!label) return;

    const key = `customplaylist:${label.toLowerCase().replace(/\s+/g, "_")}`;
    setCustomPlaylists((prev) => {
      if (prev.some((p) => p.key === key)) return prev;
      const next = [...prev, { key, label }];
      localStorage.setItem(PLAYLIST_TILES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const executeDeletePlaylistContainer = useCallback(
    async (playlistKey: string) => {
      const source = playlistSourceByKey.get(playlistKey);
      if (!source?.playlist) return;

      await fetch(`/api/playlists/${source.playlist.id}`, { method: "DELETE" });
      handleRemove(source.id, "playlist");

      setPlaylistItemAssignments((prev) => {
        const next = { ...prev };
        delete next[playlistKey];
        localStorage.setItem(PLAYLIST_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });

      setDaypartPlaylistAssignments((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(next)) {
          if (v === playlistKey) delete next[k];
        }
        localStorage.setItem(DAYPART_PLAYLIST_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });

      setSelection((sel) =>
        sel.type === "collection_container" && sel.subtype === "syncbiz_playlist" && sel.key === playlistKey
          ? { type: "library_view", id: "all_library" }
          : sel
      );
    },
    [playlistSourceByKey, handleRemove]
  );

  const executeDeleteExternalPlaylistByKey = useCallback(
    async (externalKey: string) => {
      const source = displaySources.find((s) => `external:${s.id}` === externalKey);
      if (!source?.playlist) return;

      const res = await fetch(`/api/playlists/${source.playlist.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");

      handleRemove(source.id, "playlist");

      setPlaylistItemAssignments((prev) => {
        const next = { ...prev };
        delete next[externalKey];
        localStorage.setItem(PLAYLIST_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });

      setDaypartPlaylistAssignments((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(next)) {
          if (v === externalKey) delete next[k];
        }
        localStorage.setItem(DAYPART_PLAYLIST_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });

      setSelection((sel) =>
        sel.type === "collection_container" && sel.subtype === "external_playlist" && sel.key === externalKey
          ? { type: "library_view", id: "all_library" }
          : sel
      );
    },
    [displaySources, handleRemove]
  );

  const openPlaylistTileTrash = useCallback(
    (tileKey: string) => {
      const assigned = daypartPlaylistAssignments[tileKey];
      if (assigned) {
        setTileSlotModal({ key: tileKey, variant: "clearAssignment" });
        return;
      }
      if (tileKey.startsWith("customplaylist:")) {
        setTileSlotModal({ key: tileKey, variant: "removeCustomTile" });
        return;
      }
      setTileSlotModal({ key: tileKey, variant: "empty" });
    },
    [daypartPlaylistAssignments]
  );

  const openCollectionGridTrash = useCallback((c: CollectionContainer) => {
    if (c.subtype === "external_playlist") {
      setExternalPlaylistDeleteKey(c.key);
    } else {
      setReadyCollectionModalOpen(true);
    }
  }, []);

  const activePlaylistKey =
    selection.type === "collection_container" && selection.subtype === "syncbiz_playlist" ? selection.key : null;

  /** Play / next / prev must use the full syncbiz queue order, not the stale global queue. */
  const playSyncbizPlaylistExpandedItem = useCallback(
    (item: UnifiedSource) => {
      if (!activePlaylistKey) {
        if (playSourceOverride) playSourceOverride(item);
        else playSource(item);
        return;
      }
      const queue = resolveSyncbizPlaylistPlayQueue(activePlaylistKey, sources, playlistItemAssignments);
      if (queue.length === 0 || !queue.some((q) => q.id === item.id)) {
        if (playSourceOverride) playSourceOverride(item);
        else playSource(item);
        return;
      }
      setQueue(queue, { force: true });
      const ti = playlistLeafTrackIndexForQueueItem(item);
      if (playSourceOverride) playSourceOverride(item);
      else playSource(item, ti);
    },
    [activePlaylistKey, sources, playlistItemAssignments, setQueue, playSourceOverride, playSource],
  );

  const removeItemFromPlaylistOnly = useCallback((playlistKey: string, sourceId: string) => {
    setPlaylistItemAssignments((prev) => {
      const nextItems = (prev[playlistKey] ?? []).filter((id) => id !== sourceId);
      const next = { ...prev, [playlistKey]: nextItems };
      localStorage.setItem(PLAYLIST_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /** Persist track removal for imported Ready (external) playlists — not assignment tiles. */
  const removeExpandedExternalPlaylistTrack = useCallback((item: UnifiedSource) => {
    const marker = ":track:";
    const splitAt = item.id.indexOf(marker);
    if (splitAt < 0) return;
    const parentUnifiedId = item.id.slice(0, splitAt);
    const trackKey = item.id.slice(splitAt + marker.length);
    const parent = sources.find((s) => s.id === parentUnifiedId);
    if (!parent || parent.origin !== "playlist" || !parent.playlist) return;
    const playlistId = parent.playlist.id;

    void (async () => {
      try {
        const getRes = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!getRes.ok) return;
        const playlist = (await getRes.json()) as Playlist;
        const tracks = getPlaylistTracks(playlist);
        let removeAt = tracks.findIndex((t) => t.id === trackKey);
        if (removeAt < 0) {
          removeAt = tracks.findIndex((t, i) => (t.id || String(i)) === trackKey);
        }
        if (removeAt < 0) {
          removeAt = tracks.findIndex((t) => playbackUrlsMatchUnifiedLibrary(t.url, item.url, item.type));
        }
        if (removeAt < 0) return;

        const nextTracks = tracks.filter((_, i) => i !== removeAt);
        const first = nextTracks[0];
        const order = nextTracks.map((t) => t.id).filter((id): id is string => Boolean(id && String(id).trim()));
        const body: Record<string, unknown> = {
          tracks: nextTracks,
          order,
        };
        if (first) {
          body.url = first.url;
          body.thumbnail = (first.cover ?? playlist.thumbnail ?? "").trim();
        }

        const putRes = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!putRes.ok) return;

        const updated = (await putRes.json()) as Playlist;
        savePlaylistToLocal(updated);
        window.dispatchEvent(new Event("library-updated"));
      } catch {
        /* ignore */
      }
    })();
  }, [sources]);

  const performDeleteSourceFromLibrary = useCallback(
    async (item: UnifiedSource) => {
      if (!(item.origin === "playlist" || item.origin === "source" || item.origin === "radio")) return;
      if (item.origin === "playlist" && item.playlist) {
        await fetch(`/api/playlists/${item.playlist.id}`, { method: "DELETE" });
      } else if (item.origin === "source" && item.source) {
        await fetch(`/api/sources/${item.source.id}`, { method: "DELETE" });
      } else if (item.origin === "radio" && item.radio) {
        await fetch(`/api/radio/${item.radio.id}`, { method: "DELETE" });
      }
      handleRemove(item.id, item.origin);
    },
    [handleRemove]
  );

  const deleteLibraryItem = useCallback(
    async (item: UnifiedSource) => {
      const target = findMainLibrarySourceForExpandedTrack(item, displaySources) ?? item;
      await performDeleteSourceFromLibrary(target);
    },
    [displaySources, performDeleteSourceFromLibrary]
  );

  const getItemDeleteContext = useCallback(
    (item: UnifiedSource): LibraryItemDeleteContext => {
      if (selection.type === "collection_container") {
        const key = selection.key;
        if (selection.subtype === "external_playlist") {
          return {
            kind: "in_playlist",
            onRemoveFromPlaylist: () => removeExpandedExternalPlaylistTrack(item),
          };
        }
        return {
          kind: "in_playlist",
          onRemoveFromPlaylist: () => removeItemFromPlaylistOnly(key, item.id),
        };
      }
      return { kind: "all_library" };
    },
    [selection, removeItemFromPlaylistOnly, removeExpandedExternalPlaylistTrack]
  );

  const handleAddCatalogTrackToLibrary = useCallback(
    async (source: UnifiedSource) => {
      setCatalogAddError(null);
      const requestBody = {
        url: source.url,
        title: source.title,
        cover: source.cover ?? "",
        branchId: "default",
        mediaType: catalogMediaTypeForAddToLibraryPayload(source),
      };
      const requestBodyJson = JSON.stringify(requestBody);
      const selectionSubtype =
        selection.type === "collection_container" ? selection.subtype : selection.type;
      try {
        const res = await fetch("/api/sources/add-from-catalog-track", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: requestBodyJson,
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const responseBody = JSON.stringify(data);
        if (res.status !== 200 && res.status !== 201) {
          const msg =
            typeof data.error === "string" && data.error.trim()
              ? data.error.trim()
              : `Add to library failed (${res.status})`;
          setCatalogAddError(msg);
          console.info("[SyncBiz Audit][add-from-catalog-track]", {
            rowId: source.id,
            rowUrl: source.url,
            rowType: source.type,
            selectionSubtype,
            requestStarted: true,
            requestBody: requestBodyJson,
            responseStatus: res.status,
            responseBody,
            unifiedRefetchRan: false,
            hasMatchingSrcRowAfterRefetch: false,
          });
          return;
        }
        const items = await fetchUnifiedSourcesWithFallback();
        const filtered = items.filter((s) => s.origin !== "radio");
        const hasMatchingSrcRowAfterRefetch = filtered.some(
          (s) =>
            s.origin === "source" &&
            typeof s.id === "string" &&
            s.id.startsWith("src-") &&
            playbackUrlsMatchLibraryCrossType(source.url, source.type, s.url, s.type),
        );
        setSources(filtered);
        window.dispatchEvent(new Event("library-updated"));
        console.info("[SyncBiz Audit][add-from-catalog-track]", {
          rowId: source.id,
          rowUrl: source.url,
          rowType: source.type,
          selectionSubtype,
          requestStarted: true,
          requestBody: requestBodyJson,
          responseStatus: res.status,
          responseBody,
          unifiedRefetchRan: true,
          hasMatchingSrcRowAfterRefetch,
        });
      } catch (e) {
        console.info("[SyncBiz Audit][add-from-catalog-track]", {
          rowId: source.id,
          rowUrl: source.url,
          rowType: source.type,
          selectionSubtype,
          requestStarted: true,
          requestBody: requestBodyJson,
          responseStatus: null,
          responseBody: String(e),
          unifiedRefetchRan: false,
          hasMatchingSrcRowAfterRefetch: false,
        });
        setCatalogAddError("Add to library failed (network error)");
      }
    },
    [setSources, selection],
  );

  return (
    <div className="library-theme library-page-shell flex w-full min-w-0 flex-col space-y-0" data-library-theme={libraryTheme}>
      <div className="grid w-full min-w-0 auto-rows-min grid-flow-row items-start content-start gap-3 lg:-mx-1 lg:grid-cols-[186px_minmax(0,1fr)_206px] xl:-mx-1 xl:grid-cols-[196px_minmax(0,1fr)_216px]">
        <aside className="library-list-shell row-start-1 w-full min-w-0 self-start rounded-2xl border-cyan-500/35 p-2.5 shadow-[0_10px_28px_rgba(0,0,0,0.34)] lg:col-start-1 lg:row-start-1 lg:justify-self-stretch">
          <div className="space-y-4">
            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="library-section-title text-[10px] font-semibold uppercase tracking-[0.16em]">
                  Ready Playlists
                </p>
                <button
                  type="button"
                  onClick={() => selectCollectionGroup("curated_masters")}
                  className={LIBRARY_RAIL_SHELL_ACTION_BTN_CLASS}
                  title={t.libraryShellBrowseReadyTitle}
                  aria-label={t.libraryShellBrowseReadyTitle}
                >
                  {t.libraryShellBrowseReady}
                </button>
              </div>
              <div className="library-dark-scroll max-h-64 space-y-2 overflow-y-auto pr-1">
                {containers.curated.slice(0, 8).map((c) => (
                  <div key={`ready-right:${c.key}`} className="library-source-card flex w-full items-center gap-1 rounded-xl px-1.5 py-1.5">
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        const sourcesForDrop = resolveSourcesForSelection(c.subtype, c.key);
                        const ids = sourcesForDrop.map((s) => s.id);
                        e.dataTransfer.setData(
                          "application/syncbiz-playlist-container",
                          JSON.stringify({ subtype: c.subtype, key: c.key, label: c.label } satisfies PlaylistContainerPayload)
                        );
                        if (ids.length === 0) return;
                        e.dataTransfer.setData("application/syncbiz-queue-source-ids", JSON.stringify(ids));
                        e.dataTransfer.setData("application/syncbiz-queue-sources", JSON.stringify(sourcesForDrop));
                        e.dataTransfer.effectAllowed = "copyMove";
                      }}
                      onDoubleClick={() => playCollectionSelection(c.subtype, c.key)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const ids = extractDroppedSourceIds(e);
                        assignItemsToPlaylist(c.key, ids);
                      }}
                      onClick={() => setSelection({ type: "collection_container", subtype: c.subtype, key: c.key })}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left"
                    >
                      <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-[color:var(--lib-surface-card-art)]">
                        {c.cover ? <HydrationSafeImage src={c.cover} alt="" className="h-full w-full object-cover" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="library-card-title block truncate text-xs font-medium">{c.label}</span>
                        <span className="library-card-meta block text-[10px]">{c.itemCount} items</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={LIBRARY_SIDE_ACTION_ICON_BTN_CLASS}
                      onClick={() => setReadyCollectionModalOpen(true)}
                      title={t.readyCollectionInfoTitle}
                      aria-label={t.readyCollectionInfoTitle}
                    >
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="library-section-title text-[10px] font-semibold uppercase tracking-[0.16em]">
                  Playlist Tiles
                </p>
                <button
                  type="button"
                  onClick={handleAddPlaylistTile}
                  className={LIBRARY_RAIL_SHELL_ACTION_BTN_CLASS}
                  title={t.libraryShellAddPlaylistTileTitle}
                  aria-label={t.libraryShellAddPlaylistTileTitle}
                >
                  {t.libraryShellAddPlaylistTile}
                </button>
              </div>
              <div className="space-y-2">
                {FIXED_DAYPART_PADS.map((pad) => (
                  (() => {
                    const assignedPlaylistKey = daypartPlaylistAssignments[pad.key];
                    const assignedPlaylist = assignedPlaylistKey ? playlistSourceByKey.get(assignedPlaylistKey) : undefined;
                    const tileCover = assignedPlaylist?.cover ?? containers.dayparts.find((d) => d.key === pad.key)?.cover ?? null;
                    const tileSubtype: LibraryCollectionSubtype = assignedPlaylistKey ? "syncbiz_playlist" : "daypart_collection";
                    const tileSelectionKey = assignedPlaylistKey ?? pad.key;
                    return (
                  <div
                    key={`daypart-pad:${pad.key}`}
                    draggable
                    onDragStart={(e) => {
                      const sourcesForDrop = resolveSourcesForSelection(tileSubtype, tileSelectionKey);
                      const ids = sourcesForDrop.map((s) => s.id);
                      e.dataTransfer.setData(
                        "application/syncbiz-playlist-container",
                        JSON.stringify({ subtype: tileSubtype, key: tileSelectionKey, label: pad.label } satisfies PlaylistContainerPayload)
                      );
                      if (ids.length === 0) return;
                      e.dataTransfer.setData("application/syncbiz-queue-source-ids", JSON.stringify(ids));
                      e.dataTransfer.setData("application/syncbiz-queue-sources", JSON.stringify(sourcesForDrop));
                      e.dataTransfer.effectAllowed = "copyMove";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const droppedPlaylist = extractDroppedPlaylistContainer(e);
                      if (droppedPlaylist) {
                        assignPlaylistToDaypart(pad.key, droppedPlaylist.key);
                      } else {
                        const ids = extractDroppedSourceIds(e);
                        assignItemsToPlaylist(pad.key, ids);
                      }
                      openDaypartTile(pad.key);
                    }}
                    data-drop-target="daypart-playlist"
                    data-daypart={pad.label.toLowerCase()}
                    className={`rounded-xl border bg-gradient-to-r px-3 py-2.5 ${pad.tone}`}
                    title="Drop a playlist or library items to assign to this slot"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onDoubleClick={() => playCollectionSelection(tileSubtype, tileSelectionKey)}
                        onClick={() => openDaypartTile(pad.key)}
                        className="min-w-0 flex flex-1 items-center gap-2 text-left"
                      >
                        <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-[color:var(--lib-surface-card-art)]">
                          {tileCover ? <HydrationSafeImage src={tileCover} alt="" className="h-full w-full object-cover" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="library-text-title block truncate text-sm font-semibold">{pad.label}</span>
                          <span className="library-card-meta block truncate text-[10px]">
                            {assignedPlaylist?.title ?? "Playlist"}
                          </span>
                        </span>
                      </button>
                      <div className={LIBRARY_PLAYLIST_TILE_SIDE_ACTION_CLUSTER_CLASS}>
                        <button
                          type="button"
                          className={LIBRARY_PLAYLIST_TILE_SIDE_ACTION_BTN_CLASS}
                          title={t.playlistTileScheduleActionTitle}
                          aria-label={t.playlistTileScheduleActionTitle}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlaylistTileScheduleModal({
                              daypartLabel: pad.label,
                              playlistId: assignedPlaylist?.playlist?.id,
                              playlistName: assignedPlaylist?.title,
                            });
                          }}
                        >
                          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={LIBRARY_PLAYLIST_TILE_SIDE_ACTION_BTN_CLASS}
                          title={t.removeScheduledPlaylistTitle}
                          aria-label={t.removeScheduledPlaylistTitle}
                          onClick={(e) => {
                            e.stopPropagation();
                            openPlaylistTileTrash(pad.key);
                          }}
                        >
                          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                    );
                  })()
                ))}
                {customPlaylists.map((pad) => (
                  (() => {
                    const assignedPlaylistKey = daypartPlaylistAssignments[pad.key];
                    const assignedPlaylist = assignedPlaylistKey ? playlistSourceByKey.get(assignedPlaylistKey) : undefined;
                    const tileCover = assignedPlaylist?.cover ?? null;
                    const tileSubtype: LibraryCollectionSubtype = assignedPlaylistKey ? "syncbiz_playlist" : "daypart_collection";
                    const tileSelectionKey = assignedPlaylistKey ?? pad.key;
                    return (
                  <div
                    key={`daypart-pad-custom:${pad.key}`}
                    draggable
                    onDragStart={(e) => {
                      const sourcesForDrop = resolveSourcesForSelection(tileSubtype, tileSelectionKey);
                      const ids = sourcesForDrop.map((s) => s.id);
                      e.dataTransfer.setData(
                        "application/syncbiz-playlist-container",
                        JSON.stringify({ subtype: tileSubtype, key: tileSelectionKey, label: pad.label } satisfies PlaylistContainerPayload)
                      );
                      if (ids.length === 0) return;
                      e.dataTransfer.setData("application/syncbiz-queue-source-ids", JSON.stringify(ids));
                      e.dataTransfer.setData("application/syncbiz-queue-sources", JSON.stringify(sourcesForDrop));
                      e.dataTransfer.effectAllowed = "copyMove";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const droppedPlaylist = extractDroppedPlaylistContainer(e);
                      if (droppedPlaylist) {
                        assignPlaylistToDaypart(pad.key, droppedPlaylist.key);
                      } else {
                        const ids = extractDroppedSourceIds(e);
                        assignItemsToPlaylist(pad.key, ids);
                      }
                      openDaypartTile(pad.key);
                    }}
                    data-drop-target="daypart-playlist"
                    data-daypart={pad.label.toLowerCase()}
                    className="rounded-xl border border-emerald-300/45 bg-gradient-to-r from-emerald-500/35 to-teal-500/20 px-3 py-2.5"
                    title="Drop a playlist or library items to assign to this slot"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onDoubleClick={() => playCollectionSelection(tileSubtype, tileSelectionKey)}
                        onClick={() => openDaypartTile(pad.key)}
                        className="min-w-0 flex flex-1 items-center gap-2 text-left"
                      >
                        <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-[color:var(--lib-surface-card-art)]">
                          {tileCover ? <HydrationSafeImage src={tileCover} alt="" className="h-full w-full object-cover" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="library-text-title block truncate text-sm font-semibold">{pad.label}</span>
                          <span className="library-card-meta block truncate text-[10px]">
                            {assignedPlaylist?.title ?? "Playlist"}
                          </span>
                        </span>
                      </button>
                      <div className={LIBRARY_PLAYLIST_TILE_SIDE_ACTION_CLUSTER_CLASS}>
                        <button
                          type="button"
                          className={LIBRARY_PLAYLIST_TILE_SIDE_ACTION_BTN_CLASS}
                          title={t.playlistTileScheduleActionTitle}
                          aria-label={t.playlistTileScheduleActionTitle}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlaylistTileScheduleModal({
                              daypartLabel: pad.label,
                              playlistId: assignedPlaylist?.playlist?.id,
                              playlistName: assignedPlaylist?.title,
                            });
                          }}
                        >
                          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={LIBRARY_PLAYLIST_TILE_SIDE_ACTION_BTN_CLASS}
                          title={t.removeScheduledPlaylistTitle}
                          aria-label={t.removeScheduledPlaylistTitle}
                          onClick={(e) => {
                            e.stopPropagation();
                            openPlaylistTileTrash(pad.key);
                          }}
                        >
                          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                    );
                  })()
                ))}
              </div>
            </section>
          </div>
        </aside>

        <div className="library-list-shell row-start-1 min-w-0 self-start overflow-hidden rounded-2xl p-2.5 lg:col-start-2 lg:row-start-1 lg:px-3 xl:px-3">
          <div className="library-sources-input-shell">
            <LibraryInputArea onAdd={handleAdd} playSourceOverride={playSourceOverride} />
          </div>
          {catalogAddError ? (
            <p className="mt-2 text-xs text-amber-400/95" role="alert">
              {catalogAddError}
            </p>
          ) : null}

          <div className="library-command-rail mt-3.5 flex min-w-0 flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-800/35 bg-slate-950/25 px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md sm:gap-3 lg:overflow-x-auto">
            <div className="library-command-rail-browse flex min-w-0 flex-wrap items-center gap-2 sm:gap-2.5 lg:flex-nowrap lg:min-w-0">
              <div className="library-segment-bar flex h-10 rounded-xl p-0.5" role="tablist">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={`flex h-full items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-[color,background,box-shadow] duration-200 ease-out ${
                    viewMode === "grid" ? "library-segment-btn-active" : "library-segment-btn-idle"
                  }`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                  {t.gridView}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`flex h-full items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-[color,background,box-shadow] duration-200 ease-out ${
                    viewMode === "list" ? "library-segment-btn-active" : "library-segment-btn-idle"
                  }`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                  {t.listView}
                </button>
              </div>
              {genres.length > 0 && (
                <select
                  value={genreFilter}
                  onChange={(e) => setGenreFilter(e.target.value)}
                  className="library-select h-10 min-w-[8rem] rounded-xl px-3 text-sm"
                >
                  <option value="">{t.allGenres}</option>
                  {genres.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              )}
              <Link
                href="/sources"
                className="library-nav-link-current inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold uppercase tracking-wider"
                aria-current="page"
              >
                <span className="library-nav-dot h-1.5 w-1.5 rounded-full" />
                {t.library}
              </Link>
              <Link
                href="/favorites"
                className="library-nav-link flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {t.favorites}
              </Link>
            </div>
            <div className="library-command-rail-trailing flex w-full min-w-0 shrink-0 flex-wrap items-center justify-end gap-y-2 self-center border-t border-slate-700/45 pt-2 sm:ms-auto sm:w-auto sm:flex-nowrap sm:border-t-0 sm:pt-0">
              <div className="hidden shrink-0 items-center self-center sm:flex sm:px-1.5" aria-hidden>
                <span className="h-5 w-px shrink-0 rounded-full bg-slate-700/45" />
              </div>
              <div className="library-command-rail-guest-my flex shrink-0 items-center justify-center gap-2 self-center">
                <GuestLinkButton className="h-10 shrink-0 justify-center px-3" />
                <button
                  type="button"
                  className={[guestLinkLedButtonClass, "h-10 shrink-0 justify-center px-3"].join(" ")}
                  aria-label="My link (placeholder)"
                  title="My link"
                >
                  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span>My link</span>
                </button>
              </div>
              <div className="flex shrink-0 items-center self-center px-2 sm:hidden" aria-hidden>
                <span className="h-5 w-px shrink-0 rounded-full bg-slate-700/45" />
              </div>
              <div className="hidden shrink-0 items-center self-center sm:flex sm:px-1.5" aria-hidden>
                <span className="h-5 w-px shrink-0 rounded-full bg-slate-700/45" />
              </div>
              <div className="library-command-rail-radio flex shrink-0 items-center self-center">
                <Link
                  href="/radio"
                  className="library-nav-link flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 9a5 5 0 0 1 5 5v1h6v-1a5 5 0 0 1 5-5" />
                    <path d="M4 14h16" />
                    <circle cx="12" cy="18" r="2" />
                  </svg>
                  {labels.radio[locale]}
                </Link>
              </div>
            </div>
          </div>

          <div className="library-dark-scroll mt-2 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
          {displaySources.length === 0 ? (
            <div className="library-empty-state relative overflow-hidden rounded-2xl py-20 text-center">
              <div className="library-empty-icon-plate mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl">
                <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <p className="library-empty-text mx-auto max-w-sm text-sm leading-relaxed">{t.noSourcesYetDragDrop}</p>
            </div>
          ) : selectedCollectionCards ? (
            <div className="space-y-4">
              {groupContext ? (
                <header className="library-list-shell rounded-2xl px-4 py-3">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="library-text-title text-base font-semibold tracking-tight">{groupContext.title}</h2>
                      <p className="library-text-subtitle mt-0.5 text-xs">{groupContext.subtitle}</p>
                    </div>
                    <span className="library-section-count shrink-0 text-xs tabular-nums">
                      {groupContext.count} collections
                    </span>
                  </div>
                </header>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 xl:justify-items-start">
                {selectedCollectionCards.map((c) => (
                  <div key={c.key} className="relative w-full min-w-[220px] max-w-none">
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        const sourcesForDrop =
                          c.subtype === "external_playlist" || c.subtype === "syncbiz_playlist"
                            ? resolveSourcesForSelection(c.subtype, c.key)
                            : resolveCollectionCardSources(c);
                        const ids = sourcesForDrop.map((s) => s.id);
                        e.dataTransfer.setData(
                          "application/syncbiz-playlist-container",
                          JSON.stringify({ subtype: c.subtype, key: c.key, label: c.label } satisfies PlaylistContainerPayload)
                        );
                        if (ids.length === 0) return;
                        e.dataTransfer.setData("application/syncbiz-queue-source-ids", JSON.stringify(ids));
                        e.dataTransfer.setData("application/syncbiz-queue-sources", JSON.stringify(sourcesForDrop));
                        e.dataTransfer.effectAllowed = "copyMove";
                      }}
                      onDoubleClick={() => playCollectionSelection(c.subtype, c.key)}
                      onClick={() => setSelection({ type: "collection_container", subtype: c.subtype, key: c.key })}
                      className="library-source-card flex h-[252px] w-full flex-col overflow-hidden rounded-2xl p-4 text-left"
                    >
                      <div className="mb-2 aspect-[16/9] w-full shrink-0 overflow-hidden rounded-lg bg-[color:var(--lib-surface-card-art)]">
                        {c.cover ? <HydrationSafeImage src={c.cover} alt="" className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-h-0 flex-1">
                        <p className="library-card-title text-sm font-semibold leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
                          {c.label}
                        </p>
                        <p className="library-card-meta mt-1 text-xs truncate">{c.meta ?? "Ready collection"} • {c.itemCount} items</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`absolute right-3 top-3 z-[1] ${LIBRARY_SIDE_ACTION_ICON_BTN_CLASS}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openCollectionGridTrash(c);
                      }}
                      title={c.subtype === "external_playlist" ? t.deletePlaylist : t.readyCollectionInfoTitle}
                      aria-label={c.subtype === "external_playlist" ? t.deletePlaylist : t.readyCollectionInfoTitle}
                    >
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : selectedSourceCards ? (
            <div className="space-y-4">
              <header className="library-list-shell rounded-2xl px-4 py-3">
                <h2 className="library-text-title text-base font-semibold tracking-tight">Sources</h2>
                <p className="library-text-subtitle mt-0.5 text-xs">Open, follow, and revisit recognizable channels and source worlds.</p>
              </header>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 xl:justify-items-start">
                {selectedSourceCards.map((s) => {
                  const channelSources = displaySources.filter((src) => inferSourceChannel(src).key === s.key);
                  return (
                  <div
                    key={s.key}
                    draggable={channelSources.length > 0}
                    onDragStart={(e) => setLibrarySourcesPlaylistDragPayload(e, channelSources)}
                    className={`library-source-card flex h-[268px] w-full max-w-[320px] flex-col overflow-hidden rounded-2xl p-4 ${channelSources.length > 0 ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => openSourceChannel(s.key)}
                      className="w-full min-h-0 flex-1 text-left"
                    >
                      <div className="mb-2 aspect-[16/9] w-full overflow-hidden rounded-lg bg-[color:var(--lib-surface-card-art)]">
                        {s.cover ? <HydrationSafeImage src={s.cover} alt="" className="h-full w-full object-cover" /> : null}
                      </div>
                      <p className="library-card-title text-sm font-semibold leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
                        {s.label}
                      </p>
                      <p className="library-card-meta mt-1 text-xs truncate">{s.platformLabel} • {s.itemCount} items</p>
                    </button>
                    <div className="mt-3 flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => openSourceChannel(s.key)}
                        className="library-nav-link rounded-lg px-2 py-1 text-[11px]"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFollowedSource(s.key)}
                        className="library-nav-link rounded-lg px-2 py-1 text-[11px]"
                      >
                        {followedSourceKeys.includes(s.key) ? "Remove" : "Save"}
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-12 library-sections-canvas">
              {collectionOpenContext ? (
                <header className="library-list-shell rounded-2xl px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-[color:var(--lib-border-thumb)] bg-[color:var(--lib-surface-card-art)]">
                      {collectionOpenContext.cover ? (
                        <HydrationSafeImage src={collectionOpenContext.cover} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <LibraryPlaylistCoverFallback className="h-full w-full" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="library-text-title truncate text-lg font-semibold">{collectionOpenContext.title}</h2>
                      <p className="library-text-subtitle mt-0.5 text-xs">{collectionOpenContext.subtitle}</p>
                      <p className="library-card-meta mt-1 text-xs">{collectionOpenContext.count} items</p>
                    </div>
                  </div>
                </header>
              ) : null}
              {sourceOpenContext ? (
                <header className="library-list-shell rounded-2xl px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[color:var(--lib-surface-card-art)]">
                      {sourceOpenContext.cover ? (
                        <HydrationSafeImage src={sourceOpenContext.cover} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="library-text-title truncate text-lg font-semibold">{sourceOpenContext.label}</h2>
                      <p className="library-text-subtitle mt-0.5 text-xs">{sourceOpenContext.platformLabel}</p>
                      <p className="library-card-meta mt-1 text-xs">{sourceOpenContext.itemCount} items</p>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={goBackFromSourceDetail}
                          className="library-nav-link rounded-lg px-2 py-1 text-[11px]"
                        >
                          Back
                        </button>
                        {/* Future-safe: potential internal media routing actions (e.g. Play Video / Send to Screen)
                            should be implemented here as SyncBiz-native controls, not external platform exits. */}
                        <button
                          type="button"
                          onClick={() => {
                            const first = visibleSources[0];
                            if (first) {
                              if (playSourceOverride) playSourceOverride(first);
                              else playSource(first);
                            }
                          }}
                          className="library-nav-link rounded-lg px-2 py-1 text-[11px]"
                        >
                          Play All
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleFollowedSource(sourceOpenContext.key)}
                          className="library-nav-link rounded-lg px-2 py-1 text-[11px]"
                        >
                          {followedSourceKeys.includes(sourceOpenContext.key) ? "Remove" : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                </header>
              ) : null}
              {sourceOpenContext && sourceDetailItems ? (
                <div className="space-y-8">
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="library-section-title text-[11px] font-semibold uppercase tracking-[0.16em]">From This Source</h3>
                      <span className="library-card-meta text-xs tabular-nums">{sourceDetailItems.length}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 xl:justify-items-start">
                      {sourceDetailItems.map((item) => (
                        <CenterGridLibraryItemCard
                          key={`source-item:${item.id}`}
                          item={item}
                          itemDeleteContext={getItemDeleteContext(item)}
                          onDragStart={(e) => setLibrarySourcesPlaylistDragPayload(e, [item])}
                          playSourceOverride={playSourceOverride}
                          playSource={playSource}
                          stopOverride={stopOverride}
                          pauseOverride={pauseOverride}
                          stop={stop}
                          pause={pause}
                          isActive={isMaster ? false : masterState?.currentSource?.id === item.id}
                          onDeleteFromLibrary={deleteLibraryItem}
                          libraryDeleteEligible={libraryRowEligibleForLibraryDelete(item, displaySources)}
                        />
                      ))}
                    </div>
                  </section>
                </div>
              ) : activePlaylistKey ? (
                <div className="space-y-8">
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="library-section-title text-[11px] font-semibold uppercase tracking-[0.16em]">Playlist Items</h3>
                      <span className="library-card-meta text-xs tabular-nums">{visibleSources.length}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 xl:justify-items-start">
                      {visibleSources.map((item) => (
                        <CenterGridLibraryItemCard
                          key={`playlist-item:${item.id}`}
                          item={item}
                          itemDeleteContext={getItemDeleteContext(item)}
                          onDragStart={(e) => setLibrarySourcesPlaylistDragPayload(e, [item])}
                          playSourceOverride={playSourceOverride}
                          playSource={playSource}
                          onPlayItem={playSyncbizPlaylistExpandedItem}
                          stopOverride={stopOverride}
                          pauseOverride={pauseOverride}
                          stop={stop}
                          pause={pause}
                          isActive={isMaster ? false : masterState?.currentSource?.id === item.id}
                          onDeleteFromLibrary={deleteLibraryItem}
                          libraryDeleteEligible={libraryRowEligibleForLibraryDelete(item, displaySources)}
                        />
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
              LIBRARY_SECTION_ORDER.map((sectionId: LibrarySectionId) => {
                const sectionItems = sectionBuckets[sectionId];
                if (sectionItems.length === 0) return null;
                return (
                  <section key={sectionId} className="library-section space-y-5">
                    <div className="library-section-header flex items-end gap-4 pb-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="library-section-title text-[11px] font-semibold uppercase tracking-[0.18em]">
                          {librarySectionLabel(t, sectionId)}
                        </h2>
                      </div>
                      <span className="library-section-count shrink-0 text-[11px] tabular-nums">{sectionItems.length}</span>
                    </div>
                    {viewMode === "grid" ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 xl:justify-items-start">
                        {sectionItems.map((source) => {
                          const pe = getPlaylistEntitySubtypeKey(source);
                          return (
                          <div key={source.id} className="w-full max-w-[320px] [&>article]:h-full [&>article]:min-h-[340px] [&>article]:overflow-hidden">
                            <SourceCard
                              source={source}
                              onRemove={handleRemove}
                              isFavorite={favoriteIds.includes(source.id)}
                              onToggleFavorite={() => toggleFavorite(source.id)}
                              draggable
                              onDragStart={(e) => {
                                const { pe: dragPe, sourcesForDrop } = buildPlaylistEntityDrag(source);
                                setLibrarySourcesPlaylistDragPayload(e, sourcesForDrop);
                                if (dragPe) {
                                  e.dataTransfer.setData(
                                    "application/syncbiz-playlist-container",
                                    JSON.stringify({ subtype: dragPe.subtype, key: dragPe.key, label: source.title } satisfies PlaylistContainerPayload)
                                  );
                                }
                              }}
                              onPlaySource={playSourceOverride}
                              onStop={stopOverride}
                              onPause={pauseOverride}
                              isActive={isMaster ? undefined : masterState?.currentSource?.id === source.id}
                              libraryDeckChrome
                              itemDeleteContext={getItemDeleteContext(source)}
                              explicitArtUrl={
                                isUserSyncbizPlaylistSource(source)
                                  ? deriveSyncbizPlaylistCover(
                                      source,
                                      playlistItemAssignments[`syncbiz:${source.id}`] ?? [],
                                      displaySourcesById
                                    )
                                  : undefined
                              }
                              onPlaylistEntityOpen={
                                pe
                                  ? () => setSelection({ type: "collection_container", subtype: pe.subtype, key: pe.key })
                                  : undefined
                              }
                              onPlaylistEntityPlay={pe ? () => playCollectionSelection(pe.subtype, pe.key) : undefined}
                              onAddToLibrary={
                                isExternalPlaylistExpandedTrack(selection, source)
                                  ? () => handleAddCatalogTrackToLibrary(source)
                                  : undefined
                              }
                              onLibraryDelete={deleteLibraryItem}
                              libraryDeleteEligible={libraryRowEligibleForLibraryDelete(source, displaySources)}
                              expandedTrackInMainLibrary={
                                isExternalPlaylistExpandedTrack(selection, source) &&
                                findMainLibrarySourceForExpandedTrack(source, sources) != null
                              }
                            />
                          </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="library-list-shell divide-y divide-[color:var(--lib-border-muted)] overflow-hidden rounded-2xl backdrop-blur-sm">
                        {sectionItems.map((source) => {
                          const pe = getPlaylistEntitySubtypeKey(source);
                          return (
                          <SourceRow
                            key={source.id}
                            source={source}
                            isFavorite={favoriteIds.includes(source.id)}
                            onToggleFavorite={() => toggleFavorite(source.id)}
                            draggable
                            onDragStart={(e) => {
                              const { pe: dragPe, sourcesForDrop } = buildPlaylistEntityDrag(source);
                              setLibrarySourcesPlaylistDragPayload(e, sourcesForDrop);
                              if (dragPe) {
                                e.dataTransfer.setData(
                                  "application/syncbiz-playlist-container",
                                  JSON.stringify({ subtype: dragPe.subtype, key: dragPe.key, label: source.title } satisfies PlaylistContainerPayload)
                                );
                              }
                            }}
                            onPlaySource={playSourceOverride}
                            onStop={stopOverride}
                            onPause={pauseOverride}
                            isActive={isMaster ? undefined : masterState?.currentSource?.id === source.id}
                            itemDeleteContext={getItemDeleteContext(source)}
                            onDeleteFromLibrary={deleteLibraryItem}
                            libraryDeleteEligible={libraryRowEligibleForLibraryDelete(source, displaySources)}
                            expandedTrackInMainLibrary={
                              isExternalPlaylistExpandedTrack(selection, source) &&
                              findMainLibrarySourceForExpandedTrack(source, sources) != null
                            }
                            explicitArtUrl={
                              isUserSyncbizPlaylistSource(source)
                                ? deriveSyncbizPlaylistCover(
                                    source,
                                    playlistItemAssignments[`syncbiz:${source.id}`] ?? [],
                                    displaySourcesById
                                  )
                                : undefined
                            }
                            onPlaylistEntityOpen={
                              pe
                                ? () => setSelection({ type: "collection_container", subtype: pe.subtype, key: pe.key })
                                : undefined
                            }
                            onPlaylistEntityPlay={pe ? () => playCollectionSelection(pe.subtype, pe.key) : undefined}
                            onAddToLibrary={
                              isExternalPlaylistExpandedTrack(selection, source)
                                ? () => handleAddCatalogTrackToLibrary(source)
                                : undefined
                            }
                          />
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              }))}
            </div>
          )}
          </div>
        </div>

        <aside className="library-list-shell row-start-1 w-full min-w-0 self-start rounded-2xl p-2.5 lg:col-start-3 lg:row-start-1 lg:justify-self-stretch">
          <div className="space-y-4">
            <section>
              <p className="library-section-title px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em]">
                Library
              </p>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setSelection({ type: "library_view", id: "all_library" })}
                  className="library-nav-link-current flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                >
                  <span>All Library</span>
                  <span className="text-xs tabular-nums">{displaySources.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelection({ type: "library_view", id: "recently_added" })}
                  className="library-nav-link flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                >
                  <span>Recently Added</span>
                  <span className="text-xs tabular-nums">{Math.min(displaySources.length, 24)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelection({ type: "library_view", id: "playlists" })}
                  className="library-nav-link flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                >
                  <span>Playlists</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelection({ type: "library_view", id: "sources" })}
                  className="library-nav-link flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                >
                  <span>Sources</span>
                  <span className="text-xs tabular-nums">{containers.sources.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelection({ type: "library_view", id: "favorites" })}
                  className="library-nav-link flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                >
                  <span>Favorites</span>
                  <span className="text-xs tabular-nums">{favoriteIds.length}</span>
                </button>
              </div>
            </section>

            <section>
              <p className="library-section-title px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em]">
                Your Playlists
              </p>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => void handleCreatePlaylist()}
                  className="library-nav-link-current flex w-full items-center justify-center rounded-xl px-3 py-2 text-sm"
                >
                  Add Playlist
                </button>
                <div className="library-dark-scroll max-h-48 space-y-1 overflow-y-auto pr-1">
                {userPlaylistContainers.slice(0, 10).map((p) => (
                  <div key={p.key} className="library-source-card flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-xs">
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        const sourcesForDrop = resolveSourcesForSelection("syncbiz_playlist", p.key);
                        if (sourcesForDrop.length === 0) return;
                        e.dataTransfer.setData(
                          "application/syncbiz-playlist-container",
                          JSON.stringify({ subtype: "syncbiz_playlist", key: p.key, label: p.label } satisfies PlaylistContainerPayload)
                        );
                        e.dataTransfer.setData(
                          "application/syncbiz-queue-source-ids",
                          JSON.stringify(sourcesForDrop.map((s) => s.id))
                        );
                        e.dataTransfer.setData("application/syncbiz-queue-sources", JSON.stringify(sourcesForDrop));
                        if (sourcesForDrop.length === 1) {
                          e.dataTransfer.setData("application/syncbiz-source-id", sourcesForDrop[0].id);
                          e.dataTransfer.setData("application/syncbiz-source-json", JSON.stringify(sourcesForDrop[0]));
                        }
                        e.dataTransfer.effectAllowed = "copyMove";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const ids = extractDroppedSourceIds(e);
                        assignItemsToPlaylist(p.key, ids);
                      }}
                      onClick={() => scheduleUserPlaylistRailOpen(p.key)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        if (userPlaylistRailOpenTimerRef.current) {
                          clearTimeout(userPlaylistRailOpenTimerRef.current);
                          userPlaylistRailOpenTimerRef.current = null;
                        }
                        playCollectionSelection("syncbiz_playlist", p.key);
                      }}
                      className="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:cursor-grabbing"
                    >
                      <span
                        draggable={false}
                        className="h-8 w-8 shrink-0 overflow-hidden rounded-md ring-1 ring-[color:var(--lib-border-thumb)] bg-[color:var(--lib-surface-card-art)]"
                      >
                        {p.cover ? (
                          <HydrationSafeImage
                            src={p.cover}
                            alt=""
                            draggable={false}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <LibraryPlaylistCoverFallback className="h-full w-full" />
                        )}
                      </span>
                      <span draggable={false} className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.label}</span>
                        <span className="library-card-meta block text-[10px]">{p.itemCount} item</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={LIBRARY_SIDE_ACTION_ICON_BTN_CLASS}
                      onClick={() => setPlaylistContainerDeleteKey(p.key)}
                      title={t.deletePlaylist}
                      aria-label={t.deletePlaylist}
                    >
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                ))}
                </div>
                {userPlaylistContainers.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-[color:var(--lib-text-faint)]">Create your first playlist to start building your own container.</p>
                ) : null}
              </div>
            </section>
          </div>
        </aside>

      </div>

      <DeleteConfirmModal
        isOpen={playlistContainerDeleteKey !== null}
        onClose={() => {
          if (playlistContainerDeleting) return;
          setPlaylistContainerDeleteKey(null);
        }}
        onConfirm={async () => {
          if (!playlistContainerDeleteKey) return;
          const key = playlistContainerDeleteKey;
          setPlaylistContainerDeleting(true);
          try {
            await executeDeletePlaylistContainer(key);
          } finally {
            setPlaylistContainerDeleting(false);
          }
        }}
        loading={playlistContainerDeleting}
        title={t.deletePlaylist}
        message={t.deletePlaylistConfirm}
        confirmLabel={t.confirmDelete}
      />

      <DeleteConfirmModal
        isOpen={readyCollectionModalOpen}
        onClose={() => setReadyCollectionModalOpen(false)}
        onConfirm={async () => {}}
        title={t.readyCollectionInfoTitle}
        message={t.readyCollectionInfoMessage}
        confirmLabel={t.gotIt}
      />

      <DeleteConfirmModal
        isOpen={externalPlaylistDeleteKey !== null}
        onClose={() => {
          if (externalPlaylistDeleting) return;
          setExternalPlaylistDeleteKey(null);
        }}
        onConfirm={async () => {
          if (!externalPlaylistDeleteKey) return;
          setExternalPlaylistDeleting(true);
          try {
            await executeDeleteExternalPlaylistByKey(externalPlaylistDeleteKey);
          } finally {
            setExternalPlaylistDeleting(false);
          }
        }}
        loading={externalPlaylistDeleting}
        title={t.deletePlaylist}
        message={t.deletePlaylistConfirm}
        confirmLabel={t.confirmDelete}
      />

      <DeleteConfirmModal
        isOpen={tileSlotModal !== null}
        onClose={() => {
          if (tileSlotActionLoading) return;
          setTileSlotModal(null);
        }}
        onConfirm={async () => {
          if (!tileSlotModal) return;
          if (tileSlotModal.variant === "empty") return;
          setTileSlotActionLoading(true);
          try {
            const { key, variant } = tileSlotModal;
            if (variant === "clearAssignment") {
              setDaypartPlaylistAssignments((prev) => {
                const next = { ...prev };
                delete next[key];
                localStorage.setItem(DAYPART_PLAYLIST_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
                return next;
              });
            } else if (variant === "removeCustomTile") {
              setCustomPlaylists((prev) => {
                const next = prev.filter((p) => p.key !== key);
                localStorage.setItem(PLAYLIST_TILES_STORAGE_KEY, JSON.stringify(next));
                return next;
              });
              setDaypartPlaylistAssignments((prev) => {
                const next = { ...prev };
                delete next[key];
                localStorage.setItem(DAYPART_PLAYLIST_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(next));
                return next;
              });
            }
          } finally {
            setTileSlotActionLoading(false);
          }
        }}
        loading={tileSlotActionLoading}
        title={
          tileSlotModal?.variant === "clearAssignment"
            ? t.removeScheduledPlaylistTitle
            : tileSlotModal?.variant === "removeCustomTile"
              ? t.removePlaylistTileTitle
              : tileSlotModal?.variant === "empty"
                ? t.slotNoPlaylistTitle
                : t.deletePlaylist
        }
        message={
          tileSlotModal?.variant === "clearAssignment"
            ? t.removeScheduledPlaylistMessage
            : tileSlotModal?.variant === "removeCustomTile"
              ? t.removePlaylistTileMessage
              : tileSlotModal?.variant === "empty"
                ? t.slotNoPlaylistMessage
                : t.deletePlaylistConfirm
        }
        confirmLabel={
          tileSlotModal?.variant === "clearAssignment"
            ? t.removeFromThisSlot
            : tileSlotModal?.variant === "removeCustomTile"
              ? t.removePlaylistTileConfirm
              : tileSlotModal?.variant === "empty"
                ? t.gotIt
                : t.confirmDelete
        }
      />
      <ScheduleBlockModal
        open={playlistTileScheduleModal !== null}
        onClose={() => setPlaylistTileScheduleModal(null)}
        onSaved={() => setPlaylistTileScheduleModal(null)}
        initialContext={playlistTileScheduleModal}
      />
    </div>
  );
}

function LibraryPlaylistCoverFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      draggable={false}
      className={`flex items-center justify-center bg-gradient-to-br from-cyan-600/30 via-slate-800/75 to-slate-950 text-cyan-400/45 ${className ?? ""}`}
    >
      <svg className="h-[55%] w-[55%] min-h-3 min-w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

type CenterGridLibraryItemCardProps = {
  item: UnifiedSource;
  itemDeleteContext: LibraryItemDeleteContext;
  onDragStart: (e: DragEvent) => void;
  playSourceOverride?: (s: UnifiedSource) => void;
  playSource: (s: UnifiedSource) => void;
  /** When set (e.g. expanded Your Playlist items), replaces default play — must set full queue + play for correct next/prev order. */
  onPlayItem?: (item: UnifiedSource) => void;
  stopOverride?: () => void;
  pauseOverride?: () => void;
  stop: () => void;
  pause: () => void;
  isActive: boolean;
  onDeleteFromLibrary: (item: UnifiedSource) => Promise<void>;
  libraryDeleteEligible: boolean;
};

function CenterGridLibraryItemCard({
  item,
  itemDeleteContext,
  onDragStart,
  playSourceOverride,
  playSource,
  onPlayItem,
  stopOverride,
  pauseOverride,
  stop,
  pause,
  isActive,
  onDeleteFromLibrary,
  libraryDeleteEligible,
}: CenterGridLibraryItemCardProps) {
  const { t } = useTranslations();
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const playFn = playSourceOverride ?? playSource;
  const handlePlay = () => (onPlayItem ? onPlayItem(item) : playFn(item));
  const stopFn = stopOverride ?? stop;
  const pauseFn = pauseOverride ?? pause;
  const canDel = libraryDeleteEligible;
  const showDeleteControl = canDel || itemDeleteContext.kind === "in_playlist";
  const durationSec = item.playlist?.durationSeconds ?? 0;
  const hasCoverArt = Boolean(item.cover);
  const effectiveViews = libraryCardEffectiveViewCount(item);
  const showMetaRow = libraryCardShouldShowMetaRow(item, durationSec, hasCoverArt);

  async function handleDeleteLibrary() {
    setDeleting(true);
    try {
      await onDeleteFromLibrary(item);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div
        draggable
        onDragStart={onDragStart}
        className="library-source-card flex h-[252px] w-full max-w-[320px] cursor-grab flex-col overflow-hidden rounded-2xl p-3 active:cursor-grabbing"
      >
        <div className="aspect-[16/9] w-full shrink-0 overflow-hidden rounded-lg bg-[color:var(--lib-surface-card-art)]">
          {item.cover ? <HydrationSafeImage src={item.cover} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-h-0 flex-1">
          <p className="library-card-title mt-2 text-sm font-semibold leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
            {item.title}
          </p>
          {showMetaRow ? (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <p className="library-card-meta min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.14em]">
                {libraryCardDisplayGenre(item)}
              </p>
              <div className="library-card-meta flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
                {effectiveViews != null && (
                  <span>
                    {formatViewCount(effectiveViews)} {t.views}
                  </span>
                )}
                {effectiveViews != null && durationSec > 0 && !hasCoverArt && (
                  <span className="library-card-meta-muted">•</span>
                )}
                {durationSec > 0 && !hasCoverArt && <span>{formatDuration(durationSec)}</span>}
              </div>
            </div>
          ) : null}
        </div>
        <LibrarySourceItemActions
          source={item}
          onPlay={handlePlay}
          isActive={isActive}
          onStop={stopFn}
          onPause={pauseFn}
          libraryDeckChrome
          compact
          onShareOpen={() => setShareOpen(true)}
          onDeletePress={() => setDeleteOpen(true)}
          showLibraryDelete={showDeleteControl}
        />
      </div>
      {shareOpen ? (
        <ShareModal
          item={unifiedSourceToShareable(item)}
          fallbackPlaylistId={item.origin === "playlist" ? item.id : undefined}
          fallbackRadioId={item.origin === "radio" && item.radio ? item.radio.id : undefined}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      <LibraryItemContextDeleteModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        variant={itemDeleteContext.kind === "in_playlist" ? "in_playlist" : "all_library"}
        onRemoveFromPlaylist={itemDeleteContext.kind === "in_playlist" ? itemDeleteContext.onRemoveFromPlaylist : undefined}
        onDeleteFromLibrary={handleDeleteLibrary}
        loading={deleting}
        showDeleteFromLibrary={libraryDeleteEligible}
      />
    </>
  );
}

function SourceRow({
  source,
  isFavorite,
  onToggleFavorite,
  draggable,
  onDragStart,
  onPlaySource,
  onStop,
  onPause,
  isActive: isActiveProp,
  itemDeleteContext,
  onDeleteFromLibrary,
  libraryDeleteEligible,
  expandedTrackInMainLibrary = false,
  explicitArtUrl,
  onPlaylistEntityOpen,
  onPlaylistEntityPlay,
  onAddToLibrary,
}: {
  source: UnifiedSource;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onPlaySource?: (s: UnifiedSource) => void;
  onStop?: () => void;
  onPause?: () => void;
  isActive?: boolean;
  itemDeleteContext: LibraryItemDeleteContext;
  onDeleteFromLibrary: (item: UnifiedSource) => Promise<void>;
  libraryDeleteEligible?: boolean;
  expandedTrackInMainLibrary?: boolean;
  explicitArtUrl?: string | null;
  onPlaylistEntityOpen?: () => void;
  onPlaylistEntityPlay?: () => void;
  onAddToLibrary?: () => void | Promise<void>;
}) {
  const { t } = useTranslations();
  const { playSource, stop, pause, currentSource } = usePlayback();
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const openClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playFn = onPlaySource ?? playSource;
  const stopFn = onStop ?? stop;
  const pauseFn = onPause ?? pause;
  const active = isActiveProp ?? (mounted && currentSource?.id === source.id);
  const canDel = libraryDeleteEligible ?? canDeleteFromLibrary(source);
  const showDeleteControl = canDel || itemDeleteContext.kind === "in_playlist";
  const useExplicitPlaylistArt = explicitArtUrl !== undefined;
  const thumbCover = useExplicitPlaylistArt ? explicitArtUrl : source.cover;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (openClickTimerRef.current) clearTimeout(openClickTimerRef.current);
    };
  }, []);

  function handleRowClickForOpen() {
    if (!onPlaylistEntityOpen) return;
    if (openClickTimerRef.current) clearTimeout(openClickTimerRef.current);
    openClickTimerRef.current = setTimeout(() => {
      onPlaylistEntityOpen();
      openClickTimerRef.current = null;
    }, 220);
  }

  function handleRowDoubleClickPlay(e: MouseEvent) {
    if (!onPlaylistEntityPlay) return;
    e.preventDefault();
    if (openClickTimerRef.current) {
      clearTimeout(openClickTimerRef.current);
      openClickTimerRef.current = null;
    }
    onPlaylistEntityPlay();
  }

  async function handleDeleteLibrary() {
    setDeleting(true);
    try {
      await onDeleteFromLibrary(source);
    } finally {
      setDeleting(false);
    }
  }

  function handleRowDragStart(e: React.DragEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement | null;
    const inControls = !!el?.closest(".library-row-controls");
    if (process.env.NODE_ENV !== "production") {
      console.log("[SYNC_AUDIT] SourceRow dragstart", { inControls, willPrevent: inControls });
    }
    if (inControls) {
      e.preventDefault();
      return;
    }
    onDragStart?.(e);
  }

  return (
    <>
    <div
      draggable={draggable}
      onDragStart={draggable ? handleRowDragStart : onDragStart}
      onPointerDownCapture={(e) => {
        if (!draggable) return;
        const t = e.target as HTMLElement | null;
        if (!t?.closest?.(".library-row-controls")) return;
        const top = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const hitBtn = t.closest("button");
        const topBtn = top?.closest("button") ?? null;
        if (process.env.NODE_ENV !== "production") {
          console.log("[SYNC_AUDIT] list-row pointerdown CAPTURE (inside .library-row-controls)", {
            eventTargetTag: t.tagName,
            elementFromPointTag: top?.tagName ?? null,
            hitButton: !!hitBtn,
            topMatchesHitButton: !!(hitBtn && topBtn === hitBtn),
          });
        }
      }}
      onClick={
        onPlaylistEntityOpen
          ? (e) => {
              const t = e.target as HTMLElement | null;
              if (process.env.NODE_ENV !== "production") {
                console.log("[SYNC_AUDIT] list-row click BUBBLE", {
                  tag: t?.tagName,
                  inControls: !!t?.closest?.(".library-row-controls"),
                });
              }
              handleRowClickForOpen();
            }
          : undefined
      }
      onDoubleClick={onPlaylistEntityPlay ? handleRowDoubleClickPlay : undefined}
      className={`group/row flex items-start gap-4 px-4 py-3.5 transition-[background,box-shadow] duration-200 ease-out ${
        active ? "library-playing-row library-row-active-bg" : "library-row-hover"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {/* Image left */}
      <div className="library-thumb-frame relative h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-[color:var(--lib-border-thumb)]">
        {thumbCover ? (
          <HydrationSafeImage src={thumbCover} alt="" className="h-full w-full object-cover" />
        ) : useExplicitPlaylistArt ? (
          <LibraryPlaylistCoverFallback className="h-full w-full" />
        ) : (
          <div className={`flex h-full w-full items-center justify-center ${source.origin === "radio" ? "text-rose-400/70" : "text-[color:var(--lib-text-secondary)]"}`}>
            {source.origin === "radio" ? (
              <RadioIcon className="h-7 w-7" />
            ) : (
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            )}
          </div>
        )}
        <div className="absolute bottom-0 right-0 p-0.5">
          <SourceLogo type={source.type} origin={source.origin} size="sm" />
        </div>
      </div>
      {/* Details opposite image */}
      <div className="min-w-0 flex-1 flex items-start gap-3">
        {onToggleFavorite && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`shrink-0 rounded-lg p-1 transition-colors hover:bg-[color:var(--lib-surface-row-hover)] ${isFavorite ? "text-amber-400" : "text-[color:var(--lib-text-secondary)] hover:text-amber-400/80"}`}
            title={isFavorite ? t.removeFromFavorites : t.addToFavorites}
            aria-label={isFavorite ? t.removeFromFavorites : t.addToFavorites}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex flex-col gap-0.5 pr-2">
          <span className="library-text-title font-medium tracking-tight leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">{source.title}</span>
          <div className="library-card-meta flex items-center gap-1.5 text-xs">
            {source.genre && <span>{source.genre}</span>}
            {(source.viewCount ?? source.playlist?.viewCount) != null && (
              <>
                {source.genre && <span>•</span>}
                <span className="tabular-nums">{formatViewCount(source.viewCount ?? source.playlist?.viewCount ?? 0)} {t.views}</span>
              </>
            )}
            {(source.playlist?.durationSeconds ?? 0) > 0 && (
              <>
                <span>•</span>
                <span className="tabular-nums">{formatDuration(source.playlist?.durationSeconds ?? 0)}</span>
              </>
            )}
          </div>
        </div>
        <SourceLogo type={source.type} origin={source.origin} size="md" />
      </div>
      <div
        className="library-row-controls ml-2 flex flex-nowrap items-center gap-2 shrink-0"
        role="group"
        aria-label={t.sourceControlsAria}
        draggable={false}
        onPointerDownCapture={(e) => {
          if (process.env.NODE_ENV !== "production") {
            console.log("[SYNC_AUDIT] .library-row-controls pointerdown CAPTURE", {
              targetTag: (e.target as HTMLElement | null)?.tagName,
            });
          }
        }}
        onClickCapture={(e) => {
          if (process.env.NODE_ENV !== "production") {
            console.log("[SYNC_AUDIT] .library-row-controls click CAPTURE", {
              targetTag: (e.target as HTMLElement | null)?.tagName,
            });
          }
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <LibrarySourceItemActions
          source={source}
          onPlay={() => playFn(source)}
          isActive={active}
          onStop={stopFn}
          onPause={pauseFn}
          libraryDeckChrome
          compact
          onShareOpen={() => setShareOpen(true)}
          onDeletePress={() => setDeleteOpen(true)}
          showLibraryDelete={showDeleteControl}
          onAddToLibrary={onAddToLibrary}
          inLibrary={expandedTrackInMainLibrary}
        />
      </div>
    </div>
    {shareOpen ? (
      <ShareModal
        item={unifiedSourceToShareable(source)}
        fallbackPlaylistId={source.origin === "playlist" ? source.id : undefined}
        fallbackRadioId={source.origin === "radio" && source.radio ? source.radio.id : undefined}
        onClose={() => setShareOpen(false)}
      />
    ) : null}
    <LibraryItemContextDeleteModal
      isOpen={deleteOpen}
      onClose={() => setDeleteOpen(false)}
      variant={itemDeleteContext.kind === "in_playlist" ? "in_playlist" : "all_library"}
      onRemoveFromPlaylist={itemDeleteContext.kind === "in_playlist" ? itemDeleteContext.onRemoveFromPlaylist : undefined}
      onDeleteFromLibrary={handleDeleteLibrary}
      loading={deleting}
      showDeleteFromLibrary={canDel}
    />
    </>
  );
}

function SourceLogo({ type, origin, size }: { type: UnifiedSource["type"]; origin?: UnifiedSource["origin"]; size: "sm" | "md" }) {
  const { t } = useTranslations();
  const { locale } = useLocale();
  const sizeClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const color =
    type === "youtube" ? "text-[#ff0000]" : type === "soundcloud" ? "text-[#ff5500]" : type === "spotify" ? "text-[#1db954]" : "text-[color:var(--lib-text-secondary)]";
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
      <span
        className={`library-badge-logo flex ${sizeClass} items-center justify-center rounded-lg p-1 text-rose-400`}
        title={labels.radio[locale]}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={sizeClass}>
          <path d="M4 9a5 5 0 0 1 5 5v1h6v-1a5 5 0 0 1 5-5" />
          <path d="M4 14h16" />
          <circle cx="12" cy="18" r="2" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`library-badge-logo flex ${sizeClass} items-center justify-center rounded-lg p-1 ${color}`} title={typeTitle}>
      {type === "youtube" && (
        <svg viewBox="0 0 24 24" fill="currentColor" className={sizeClass}>
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      )}
      {type === "soundcloud" && (
        <svg viewBox="0 0 24 24" fill="currentColor" className={sizeClass}>
          <path d="M12 4.5c-1.5 0-2.8.5-3.9 1.2-.5.3-.9.7-1.1 1.2-.2-.1-.4-.1-.6-.1-1.1 0-2 .9-2 2v.1c-1.5.3-2.5 1.5-2.5 3 0 1.7 1.3 3 3 3h6.5c2.2 0 4-1.8 4-4 0-2.2-1.8-4-4-4-.2 0-.4 0-.6.1-.2-1.2-1.2-2.1-2.4-2.1z" />
        </svg>
      )}
      {type === "spotify" && (
        <svg viewBox="0 0 24 24" fill="currentColor" className={sizeClass}>
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
        </svg>
      )}
      {(type === "local" || type === "winamp" || type === "stream-url") && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={sizeClass}>
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="12" y2="17" />
        </svg>
      )}
    </span>
  );
}
