"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { useTranslations } from "@/lib/locale-context";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { ActionButtonEdit } from "@/components/ui/action-buttons";
import { SourcesPlaybackProvider, useSourcesPlayback } from "@/lib/sources-playback-context";
import { usePlayback } from "@/lib/playback-provider";
import { SourceCard } from "@/components/source-card-unified";
import { getFavorites, removeFavorite as removeFav } from "@/lib/favorites-store";
import type { UnifiedSource } from "@/lib/source-types";

type ViewMode = "grid" | "list";

type Props = {
  allSources: UnifiedSource[];
};

function useFavoritesState() {
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  useEffect(() => {
    setFavoriteIds(getFavorites());
  }, []);
  const removeFavorite = useCallback((id: string) => {
    removeFav(id);
    setFavoriteIds(getFavorites());
  }, []);
  const toggleFavorite = useCallback((id: string) => {
    const ids = getFavorites();
    if (ids.includes(id)) removeFav(id);
    setFavoriteIds(getFavorites());
  }, []);
  return { favoriteIds, removeFavorite, toggleFavorite, refresh: () => setFavoriteIds(getFavorites()) };
}

export function FavoritesManager({ allSources }: Props) {
  const { favoriteIds, toggleFavorite, refresh } = useFavoritesState();
  const favoriteSources = useMemo(
    () => allSources.filter((s) => favoriteIds.includes(s.id)),
    [allSources, favoriteIds]
  );
  const sources = useMemo(() => favoriteSources, [favoriteSources]);

  return (
    <SourcesPlaybackProvider sources={sources}>
      <FavoritesManagerInner
        favoriteSources={favoriteSources}
        toggleFavorite={toggleFavorite}
        refresh={refresh}
      />
    </SourcesPlaybackProvider>
  );
}

function FavoritesManagerInner({
  favoriteSources,
  toggleFavorite,
  refresh,
}: {
  favoriteSources: UnifiedSource[];
  toggleFavorite: (id: string) => void;
  refresh: () => void;
}) {
  const router = useRouter();
  const { t } = useTranslations();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const { setQueue } = usePlayback();

  useEffect(() => {
    setQueue(favoriteSources);
  }, [favoriteSources, setQueue]);

  const handleRemove = useCallback(
    (id: string) => {
      toggleFavorite(id);
      refresh();
      router.refresh();
    },
    [toggleFavorite, refresh, router]
  );

  if (favoriteSources.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/40 py-16 text-center">
        <p className="text-slate-500">{t.noFavoritesYet}</p>
        <Link
          href="/sources"
          className="mt-4 inline-flex items-center gap-2 rounded-xl border-2 border-cyan-500/50 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.15)] transition hover:border-cyan-500/80 hover:bg-cyan-500/20"
        >
          {t.library}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex rounded-xl border border-slate-800 bg-slate-900/60 p-0.5" role="tablist">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              viewMode === "grid" ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.gridView}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              viewMode === "list" ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.listView}
          </button>
        </div>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {favoriteSources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onRemove={handleRemove}
              isFavorite
              onToggleFavorite={() => { toggleFavorite(source.id); refresh(); }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 divide-y divide-slate-800/60 overflow-hidden">
          {favoriteSources.map((source) => (
            <FavoritesSourceRow
              key={source.id}
              source={source}
              onRemove={handleRemove}
              isFavorite
              onToggleFavorite={() => { toggleFavorite(source.id); refresh(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FavoritesSourceRow({
  source,
  onRemove,
  isFavorite,
  onToggleFavorite,
}: {
  source: UnifiedSource;
  onRemove: (id: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const { t } = useTranslations();
  const { playSource, stop, pause, currentSource } = usePlayback();
  const [shareOpen, setShareOpen] = useState(false);
  const active = currentSource?.id === source.id;

  return (
    <div
      className={`grid grid-cols-[auto,1fr,auto] gap-4 items-center rounded-xl px-4 py-3 transition-all hover:bg-slate-900/40 ${
        active ? "playing-active bg-slate-900/60" : ""
      }`}
    >
      <div className="relative h-14 w-14 overflow-hidden rounded-lg bg-slate-800">
        {source.cover ? (
          <img src={source.cover} alt="" className="h-full w-full object-cover" />
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
      <div className="min-w-0 flex-1 flex items-center gap-3">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`shrink-0 rounded-lg p-1 transition-colors hover:bg-slate-700/60 ${isFavorite ? "text-amber-400" : "text-slate-500"}`}
          title={t.removeFromFavorites}
          aria-label={t.removeFromFavorites}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
        <span className="truncate font-medium text-slate-100">{source.title}</span>
        {source.genre && <span className="text-xs text-slate-500">{source.genre}</span>}
      </div>
      <div className="flex flex-nowrap items-center gap-2">
        {shareOpen && (
          <ShareModal
            item={unifiedSourceToShareable(source)}
            fallbackPlaylistId={source.origin === "playlist" ? source.id : undefined}
            fallbackRadioId={source.origin === "radio" && source.radio ? source.radio.id : undefined}
            onClose={() => setShareOpen(false)}
          />
        )}
        {active ? (
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
        ) : (
          <NeonControlButton size="md" onClick={() => playSource(source)} title="Play" aria-label="Play">
            <svg className="h-5 w-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </NeonControlButton>
        )}
        {source.origin === "playlist" && source.playlist && (
          <ActionButtonEdit href={`/playlists/${source.playlist.id}/edit`} variant="subtle" size="xs" title="Edit" aria-label="Edit" />
        )}
        {source.origin === "radio" && source.radio && (
          <ActionButtonEdit href={`/radio/${source.radio.id}/edit`} variant="subtle" size="xs" title="Edit" aria-label="Edit" />
        )}
        <NeonControlButton size="sm" onClick={() => setShareOpen(true)} title={t.share} aria-label={t.share}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </NeonControlButton>
        <FavoritesRowDeleteButton source={source} onRemove={onRemove} />
      </div>
    </div>
  );
}

function FavoritesRowDeleteButton({ source, onRemove }: { source: UnifiedSource; onRemove: (id: string) => void }) {
  const router = useRouter();
  const { t } = useTranslations();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      let ok = false;
      if (source.origin === "playlist" && source.playlist) {
        const res = await fetch(`/api/playlists/${source.playlist.id}`, { method: "DELETE" });
        ok = res.ok;
      } else if (source.origin === "source" && source.source) {
        const res = await fetch(`/api/sources/${source.source.id}`, { method: "DELETE" });
        ok = res.ok;
      } else if (source.origin === "radio" && source.radio) {
        const res = await fetch(`/api/radio/${source.radio.id}`, { method: "DELETE" });
        ok = res.ok;
      }
      if (ok) {
        removeFav(source.id);
        onRemove(source.id);
      }
      router.refresh();
    } finally {
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
