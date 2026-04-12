"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { log as mvpLog } from "@/lib/mvp-logger";
import { SourceCard } from "@/components/source-card-unified";
import { getFavorites, addFavorite, removeFavorite } from "@/lib/favorites-store";
import { fetchUnifiedSourcesWithFallback, removePlaylistFromLocal } from "@/lib/unified-sources-client";
import { usePlayback } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";

export default function LibraryPage() {
  const [playlists, setPlaylists] = useState<UnifiedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const { setQueue } = usePlayback();

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    setFavoriteIds(getFavorites());
  }, []);

  useEffect(() => {
    const handler = () => setRefreshTrigger((t) => t + 1);
    window.addEventListener("library-updated", handler);
    return () => window.removeEventListener("library-updated", handler);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setPlaylists((prev) => prev.filter((s) => s.id !== id));
    removePlaylistFromLocal(id);
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    const ids = getFavorites();
    if (ids.includes(id)) {
      removeFavorite(id);
    } else {
      addFavorite(id);
    }
    setFavoriteIds(getFavorites());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchPlaylists() {
      setLoading(true);
      setError(null);
      try {
        const items = await fetchUnifiedSourcesWithFallback();
        if (cancelled) return;
        const filtered = items.filter((s) => s.origin === "playlist");
        setPlaylists(filtered);
        setQueue(filtered);
      } catch (e) {
        if (!cancelled) {
          mvpLog("playlist_load_failed", { error: String(e) });
          setError("Failed to load playlists");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchPlaylists();
    return () => { cancelled = true; };
  }, [setQueue, refreshTrigger]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-slate-500">
        Loading playlists…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-rose-400">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">Library</h1>
        <p className="mt-1 text-sm text-slate-400">
          Your playlists. Click play to start listening.
        </p>
      </div>
      {playlists.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-slate-500">
          No playlists yet.{" "}
          <Link href="/sources" className="text-sky-400 hover:text-sky-300 underline">
            Add playlists
          </Link>{" "}
          by pasting or dropping URLs.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {playlists.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onRemove={handleRemove}
              isFavorite={favoriteIds.includes(source.id)}
              onToggleFavorite={() => toggleFavorite(source.id)}
              libraryTilePresentation="branch"
            />
          ))}
        </div>
      )}
    </div>
  );
}
