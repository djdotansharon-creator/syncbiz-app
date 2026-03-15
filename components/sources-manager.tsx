"use client";

import { useState, useCallback, useMemo, useEffect, useRef, startTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { useLocale, useTranslations } from "@/lib/locale-context";
import { labels } from "@/lib/locale-context";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { ActionButtonEdit, ActionButtonShare } from "@/components/ui/action-buttons";
import { RadioIcon } from "@/components/ui/radio-icon";
import { formatViewCount, formatDuration } from "@/lib/format-utils";
import { SourcesPlaybackProvider, useSourcesPlayback } from "@/lib/sources-playback-context";
import { usePlayback } from "@/lib/playback-provider";
import { SourceCard } from "@/components/source-card-unified";
import { LibraryInputArea } from "@/components/library-input-area";
import { getFavorites, addFavorite as addFav, removeFavorite as removeFav } from "@/lib/favorites-store";
import { fetchUnifiedSourcesWithFallback, savePlaylistToLocal, saveRadioToLocal, removePlaylistFromLocal, removeRadioFromLocal } from "@/lib/unified-sources-client";
import type { UnifiedSource } from "@/lib/source-types";

type ViewMode = "grid" | "list";

type Props = {
  initialSources: UnifiedSource[];
  pageTitle?: string;
  pageSubtitle?: string;
};

export function SourcesManager({ initialSources, pageTitle, pageSubtitle }: Props) {
  const [effectiveSources, setEffectiveSources] = useState<UnifiedSource[]>(initialSources);

  useEffect(() => {
    if (initialSources.length > 0) {
      setEffectiveSources(initialSources);
    } else {
      fetchUnifiedSourcesWithFallback().then((items) => {
        setEffectiveSources(items.filter((s) => s.origin !== "radio"));
      });
    }
  }, [initialSources]);

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

function SourcesManagerInner({ pageTitle, pageSubtitle }: { pageTitle?: string; pageSubtitle?: string }) {
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const { t } = useTranslations();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [genreFilter, setGenreFilter] = useState("");
  const { favoriteIds, toggleFavorite } = useFavoritesState();
  const playlistAutoLoaded = useRef(false);

  const { sources, setSources } = useSourcesPlayback();
  const { setQueue, playSource } = usePlayback();

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

  useEffect(() => {
    setQueue(displaySources);
  }, [displaySources, setQueue]);

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

  return (
    <div className="space-y-6">
      {/* Title & subtitle – no frame, lively colors like player */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">{pageTitle ?? t.library}</h1>
        <p className="mt-0.5 text-sm text-slate-300">{pageSubtitle ?? t.libraryPageSubtitle}</p>
      </div>

      <LibraryInputArea onAdd={handleAdd} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 rounded-xl border border-slate-800/80 bg-slate-800/80 ring-1 ring-slate-700/60 p-0.5" role="tablist">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`flex h-full items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${
                viewMode === "grid" ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
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
              className={`flex h-full items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${
                viewMode === "list" ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
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
              className="h-9 rounded-xl border border-slate-800/80 bg-slate-800/80 ring-1 ring-slate-700/60 px-3 text-sm text-slate-200"
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
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 text-xs font-semibold uppercase tracking-wider text-sky-300"
            aria-current="page"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            {t.library}
          </Link>
          <Link
            href="/favorites"
            className="flex h-9 items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-800/80 ring-1 ring-slate-700/60 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-700 hover:bg-slate-800 hover:text-slate-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            {t.favorites}
          </Link>
          <Link
            href="/radio"
            className="flex h-9 items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-800/80 ring-1 ring-slate-700/60 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-700 hover:bg-slate-800 hover:text-slate-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9a5 5 0 0 1 5 5v1h6v-1a5 5 0 0 1 5-5" />
              <path d="M4 14h16" />
              <circle cx="12" cy="18" r="2" />
            </svg>
            {labels.radio?.[locale] ?? "Radio"}
          </Link>
        </div>
      </div>

      {displaySources.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 ring-1 ring-slate-700/60 py-16 text-center text-sm text-slate-500">
          {t.noSourcesYetDragDrop}
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {displaySources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onRemove={handleRemove}
              isFavorite={favoriteIds.includes(source.id)}
              onToggleFavorite={() => toggleFavorite(source.id)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/syncbiz-source-id", source.id);
                e.dataTransfer.effectAllowed = "move";
              }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 ring-1 ring-slate-700/60 divide-y divide-slate-800/60 overflow-hidden">
          {displaySources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onRemove={handleRemove}
              isFavorite={favoriteIds.includes(source.id)}
              onToggleFavorite={() => toggleFavorite(source.id)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/syncbiz-source-id", source.id);
                e.dataTransfer.effectAllowed = "move";
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceRow({
  source,
  onRemove,
  isFavorite,
  onToggleFavorite,
  draggable,
  onDragStart,
}: {
  source: UnifiedSource;
  onRemove: (id: string) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const { t } = useTranslations();
  const { playSource, stop, pause, currentSource } = usePlayback();
  const [shareOpen, setShareOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const active = mounted && currentSource?.id === source.id;

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`flex items-center gap-4 rounded-xl px-4 py-3 transition-all hover:bg-slate-900/40 ${
        active ? "playing-active bg-slate-900/60" : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {/* Image left */}
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-800">
        {source.cover ? (
          <HydrationSafeImage src={source.cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className={`flex h-full w-full items-center justify-center ${source.origin === "radio" ? "text-rose-400/70" : "text-slate-500"}`}>
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
      <div className="min-w-0 flex-1 flex items-center gap-3">
        {onToggleFavorite && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`shrink-0 rounded-lg p-1 transition-colors hover:bg-slate-700/60 ${isFavorite ? "text-amber-400" : "text-slate-500 hover:text-amber-400/70"}`}
            title={isFavorite ? t.removeFromFavorites : t.addToFavorites}
            aria-label={isFavorite ? t.removeFromFavorites : t.addToFavorites}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="truncate font-medium text-slate-100">{source.title}</span>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            {source.genre && <span>{source.genre}</span>}
            {(source.viewCount ?? source.playlist?.viewCount) != null && (
              <>
                {source.genre && <span>•</span>}
                <span className="tabular-nums">{formatViewCount(source.viewCount ?? source.playlist?.viewCount ?? 0)} {t.views ?? "views"}</span>
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
      {/* Spacer to center controls */}
      <div className="flex-1 min-w-0" />
      {/* Controls centered */}
      <div className="flex flex-nowrap items-center gap-2 shrink-0" role="group" aria-label="Source controls">
        {shareOpen && (
          <ShareModal
            item={unifiedSourceToShareable(source)}
            fallbackPlaylistId={source.origin === "playlist" ? source.id : undefined}
            fallbackRadioId={source.origin === "radio" && source.radio ? source.radio.id : undefined}
            onClose={() => setShareOpen(false)}
          />
        )}
        {active && (
          <>
            <NeonControlButton size="sm" onClick={stop} title="Stop" aria-label="Stop">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h12v12H6z" />
              </svg>
            </NeonControlButton>
            <NeonControlButton size="md" onClick={() => playSource(source)} active title="Play" aria-label="Play">
              <svg className="h-5 w-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7L8 5z" />
              </svg>
            </NeonControlButton>
            <NeonControlButton size="sm" onClick={pause} active title="Pause" aria-label="Pause">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </NeonControlButton>
          </>
        )}
        {!active && (
          <NeonControlButton size="md" onClick={() => playSource(source)} title="Play" aria-label="Play">
            <svg className="h-5 w-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </NeonControlButton>
        )}
        {source.origin === "playlist" && source.playlist && (
          <ActionButtonEdit href={`/playlists/${source.playlist.id}/edit`} variant="player" title="Edit" aria-label="Edit" />
        )}
        {source.origin === "radio" && source.radio && (
          <ActionButtonEdit href={`/radio/${source.radio.id}/edit`} variant="player" title="Edit" aria-label="Edit" />
        )}
        {source.origin === "source" && source.source && (
          <ActionButtonEdit href={`/sources/${source.source.id}/edit`} variant="player" title="Edit" aria-label="Edit" />
        )}
        <ShareButton source={source} onShareOpen={() => setShareOpen(true)} />
        <SourceRowDeleteButton source={source} onRemove={onRemove} />
      </div>
      <div className="flex-1 min-w-0" />
    </div>
  );
}

function SourceRowDeleteButton({ source, onRemove }: { source: UnifiedSource; onRemove: (id: string, origin?: UnifiedSource["origin"]) => void }) {
  const { t } = useTranslations();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      setDeleteOpen(false);
    }
  }

  return (
    <>
      <NeonControlButton variant="red" size="sm" onClick={() => setDeleteOpen(true)} title={t.deletePlaylist} aria-label={t.deletePlaylist}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </NeonControlButton>
      <DeleteConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} loading={deleting} message={t.deleteSourceConfirm} />
    </>
  );
}

function ShareButton({ source, onShareOpen }: { source: UnifiedSource; onShareOpen: () => void }) {
  const { t } = useTranslations();
  return (
    <ActionButtonShare variant="player" onClick={onShareOpen} title={t.share} aria-label={t.share} />
  );
}

function SourceLogo({ type, origin, size }: { type: UnifiedSource["type"]; origin?: UnifiedSource["origin"]; size: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const color =
    type === "youtube" ? "text-[#ff0000]" : type === "soundcloud" ? "text-[#ff5500]" : type === "spotify" ? "text-[#1db954]" : "text-slate-300";
  if (origin === "radio") {
    return (
      <span className={`flex ${sizeClass} items-center justify-center rounded-lg bg-black/60 p-1 text-rose-400`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={sizeClass}>
          <path d="M4 9a5 5 0 0 1 5 5v1h6v-1a5 5 0 0 1 5-5" />
          <path d="M4 14h16" />
          <circle cx="12" cy="18" r="2" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`flex ${sizeClass} items-center justify-center rounded-lg bg-black/60 p-1 ${color}`}>
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
