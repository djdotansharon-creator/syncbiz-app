"use client";

import { useEffect, useState } from "react";
import { usePlayback } from "@/lib/playback-provider";
import { log as mvpLog } from "@/lib/mvp-logger";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import type { UnifiedSource } from "@/lib/source-types";

function PlaylistCard({
  source,
  onPlay,
  isActive,
}: {
  source: UnifiedSource;
  onPlay: () => void;
  isActive: boolean;
}) {
  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/60 transition-all duration-200 hover:border-slate-700/80 hover:bg-slate-900/40"
      data-source-id={source.id}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-t-2xl bg-slate-900">
        {source.cover ? (
          <HydrationSafeImage
            src={source.cover}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-slate-500">
            <svg
              className="h-10 w-10 opacity-60"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="truncate text-base font-semibold text-slate-100">
          {source.title}
        </h3>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {source.genre}
        </p>
        <div className="flex justify-center">
          <NeonControlButton
            onClick={onPlay}
            size="md"
            active={isActive}
            title="Play"
            aria-label="Play"
          >
            <svg className="h-4 w-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </NeonControlButton>
        </div>
      </div>
    </article>
  );
}

export default function LibraryPage() {
  const [playlists, setPlaylists] = useState<UnifiedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { playSource, currentSource } = usePlayback();

  useEffect(() => {
    let cancelled = false;
    async function fetchPlaylists() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/sources/unified", { cache: "no-store" });
        if (!res.ok) {
          mvpLog("playlist_load_failed", { status: res.status });
          setError("Failed to load playlists");
          return;
        }
        const items = (await res.json()) as UnifiedSource[];
        if (cancelled) return;
        const filtered = items.filter((s) => s.origin === "playlist");
        setPlaylists(filtered);
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
  }, []);

  function handlePlay(source: UnifiedSource) {
    mvpLog("playlist_selected", { id: source.id, title: source.title });
    playSource(source);
  }

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
          No playlists yet. Add playlists from the Playlists page.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {playlists.map((source) => (
            <PlaylistCard
              key={source.id}
              source={source}
              onPlay={() => handlePlay(source)}
              isActive={currentSource?.id === source.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
