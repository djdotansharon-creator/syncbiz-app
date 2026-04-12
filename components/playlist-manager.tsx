"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PlaylistCard } from "@/components/playlist-card";
import { AddPlaylistForm } from "@/components/add-playlist-form";
import { SharePlaylistModal } from "@/components/share-playlist-modal";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { useTranslations } from "@/lib/locale-context";
import { LIBRARY_SIDE_ACTION_ICON_BTN_CLASS } from "@/lib/library-side-action-styles";
import { DenseDataRowSurface } from "@/components/player-surface/dense-data-row-surface";
import { DENSE_PLAYLIST_MANAGER_ROW_GRID_CLASS } from "@/lib/player-surface/dense-data-row-constants";
import { PlaylistIconBadge } from "@/components/playlist-icon-badge";
import { PlaylistPlayerProvider, usePlaylistPlayer } from "@/lib/playlist-player-context";
import type { Playlist } from "@/lib/playlist-types";

type ViewMode = "grid" | "list";

type Props = {
  initialPlaylists: Playlist[];
};

export function PlaylistManager({ initialPlaylists }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [playlists, setPlaylists] = useState(initialPlaylists);
  const [imported, setImported] = useState(false);

  useEffect(() => {
    const importData = searchParams.get("import");
    if (!importData || imported) return;
    try {
      const data = JSON.parse(decodeURIComponent(importData)) as Playlist;
      if (data.id && data.name && data.url) {
        fetch("/api/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.name,
            url: data.url,
            genre: data.genre ?? "",
            type: data.type ?? "stream-url",
            thumbnail: data.thumbnail ?? "",
          }),
        }).then((res) => {
          if (res.ok) {
            res.json().then((p) => setPlaylists((prev) => [p, ...prev]));
            router.replace("/playlists");
          }
        });
        setImported(true);
      }
    } catch {
      // ignore invalid import
    }
  }, [searchParams, imported, router]);

  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [genreFilter, setGenreFilter] = useState<string>("");
  const [shuffle, setShuffle] = useState(false);
  const [sharePlaylist, setSharePlaylist] = useState<Playlist | null>(null);

  const genres = [...new Set(playlists.map((p) => p.genre).filter(Boolean))].sort();

  const filtered = useMemo(
    () =>
      genreFilter
        ? playlists.filter((p) => p.genre.toLowerCase() === genreFilter.toLowerCase())
        : playlists,
    [playlists, genreFilter],
  );

  const displayed = useMemo(
    () => (shuffle ? [...filtered].sort(() => Math.random() - 0.5) : filtered),
    [filtered, shuffle],
  );

  const handleAdd = useCallback((p: Playlist) => {
    setPlaylists((prev) => [p, ...prev]);
    router.refresh();
  }, [router]);

  const handleShare = useCallback((p: Playlist) => {
    setSharePlaylist(p);
  }, []);

  return (
    <div className="space-y-6">
      {/* Search + drag area at top */}
      <AddPlaylistForm onAdd={handleAdd} />

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex rounded-2xl border border-slate-800/60 bg-slate-900/40 p-0.5"
              role="tablist"
              aria-label="View mode"
            >
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "grid" ? "bg-slate-700/80 text-slate-100" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "list" ? "bg-slate-700/80 text-slate-100" : "text-slate-500 hover:text-slate-300"
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
                List
              </button>
            </div>
            {genres.length > 0 && (
              <select
                value={genreFilter}
                onChange={(e) => setGenreFilter(e.target.value)}
                className="rounded-xl border border-slate-800/60 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-200"
              >
                <option value="">All genres</option>
                {genres.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={shuffle}
                onChange={(e) => setShuffle(e.target.checked)}
                className="rounded border-slate-700"
              />
              Shuffle
            </label>
          </div>
        </div>

        {displayed.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/60 bg-slate-950/30 py-20 text-center">
            <p className="text-sm text-slate-500">No playlists yet.</p>
            <p className="mt-1 text-xs text-slate-600">Paste a URL above or drag one here.</p>
          </div>
        ) : (
          <PlaylistPlayerProvider playlists={displayed}>
            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {displayed.map((p, i) => (
                  <PlaylistCard key={p.id} playlist={p} index={i} onShare={handleShare} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-800/60 bg-slate-950/30 divide-y divide-slate-800/40 overflow-hidden">
                {displayed.map((p, i) => (
                  <PlaylistRow key={p.id} playlist={p} index={i} onShare={handleShare} />
                ))}
              </div>
            )}
          </PlaylistPlayerProvider>
        )}
      </section>

      {sharePlaylist && (
        <SharePlaylistModal
          playlist={sharePlaylist}
          onClose={() => setSharePlaylist(null)}
        />
      )}
    </div>
  );
}

function PlaylistRow({
  playlist,
  index,
  onShare,
}: {
  playlist: Playlist;
  index: number;
  onShare: (p: Playlist) => void;
}) {
  const router = useRouter();
  const { t } = useTranslations();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { status, volume, isActive, play, pause, stop, setVolume } = usePlaylistPlayer();

  const active = isActive(index);
  const embedded = playlist.type === "youtube" || playlist.type === "soundcloud";
  const localOrStream = !embedded;

  useEffect(() => {
    if (!active || !localOrStream || status !== "playing") return;
    const ctrl = new AbortController();
    fetch("/api/commands/play-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: playlist.url }),
      signal: ctrl.signal,
    }).catch(() => {});
    return () => ctrl.abort();
  }, [active, localOrStream, status, playlist.url]);

  const thumbnail =
    playlist.thumbnail ||
    (playlist.type === "youtube"
      ? `https://img.youtube.com/vi/${playlist.url.match(/(?:v=|\/)([^&\s?/]+)/)?.[1]}/default.jpg`
      : null);

  async function handleStopLocal() {
    await fetch("/api/commands/stop-local", { method: "POST" });
    stop();
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/playlists/${playlist.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) throw new Error("Failed to delete");
    router.refresh();
  }

  return (
    <div>
      <DenseDataRowSurface
        gridClassName={DENSE_PLAYLIST_MANAGER_ROW_GRID_CLASS}
        className={active ? "bg-slate-900/40 ring-1 ring-inset ring-slate-500/20" : "hover:bg-slate-900/20"}
        cells={[
          <div key="thumb" className="relative h-16 w-16 overflow-hidden rounded-xl bg-slate-800">
            {thumbnail ? (
              <img src={thumbnail} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-500">
                <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
            <div className="absolute bottom-0.5 right-0.5">
              <PlaylistIconBadge type={playlist.type} size="md" />
            </div>
          </div>,
          <div key="meta" className="min-w-0">
            <p className="truncate font-semibold text-slate-100">{playlist.name}</p>
            {playlist.genre ? <p className="text-xs text-slate-500">{playlist.genre}</p> : null}
            <p className="text-xs capitalize text-slate-600">{playlist.type.replace(/-/g, " ")}</p>
          </div>,
          <div key="transport" className="flex items-center justify-center gap-2">
            {active ? (
              <>
                <button
                  type="button"
                  onClick={embedded ? stop : () => void handleStopLocal()}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/60 text-slate-400 hover:bg-slate-700/80"
                  title="Stop"
                >
                  ■
                </button>
                <button
                  type="button"
                  onClick={() => play(index)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1db954] text-white hover:bg-[#1ed760]"
                >
                  ▶
                </button>
                {embedded ? (
                  <button
                    type="button"
                    onClick={pause}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/60 text-slate-400 hover:bg-slate-700/80"
                    title="Pause"
                  >
                    ⏸
                  </button>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                onClick={() => play(index)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1db954] text-white hover:bg-[#1ed760]"
              >
                ▶
              </button>
            )}
          </div>,
          <div key="tools" className="flex items-center gap-2">
            {active ? (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-[10px] text-slate-600">Vol</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="h-1.5 w-20 rounded-full bg-slate-800 accent-[#1db954]"
                  aria-label="Volume"
                />
              </div>
            ) : null}
            <Link
              href={`/playlists/${playlist.id}/edit`}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900/70 text-slate-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.2)] transition hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 hover:shadow-[0_0_12px_rgba(100,116,139,0.06)]"
              title="Edit"
            >
              ✎
            </Link>
            <button
              type="button"
              onClick={() => onShare(playlist)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
              title="Share"
            >
              ↗
            </button>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className={LIBRARY_SIDE_ACTION_ICON_BTN_CLASS}
              title={t.deletePlaylist}
              aria-label={t.deletePlaylist}
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          </div>,
        ]}
      />
      <DeleteConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        loading={deleting}
        title={t.deletePlaylist}
        message={t.deletePlaylistConfirm}
      />
    </div>
  );
}
