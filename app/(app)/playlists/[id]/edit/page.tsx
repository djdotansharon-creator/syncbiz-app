"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import type { Playlist, PlaylistType, PlaylistTrack } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { getPlaylistsLocal } from "@/lib/playlists-local-store";

export default function EditPlaylistPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const returnTo = searchParams.get("return") || "/playlists";
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [genre, setGenre] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [type, setType] = useState<PlaylistType>("stream-url");
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/playlists/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: Playlist) => {
        setPlaylist(data);
        setName(data.name);
        setUrl(data.url);
        setGenre(data.genre ?? "");
        setThumbnail(data.thumbnail ?? "");
        setType(data.type);
        const tracksList = getPlaylistTracks(data);
        setTracks(tracksList);
        setOrder(data.order ?? tracksList.map((t) => t.id));
      })
      .catch(async () => {
        const local = getPlaylistsLocal().find((p) => p.id === id || `pl-${p.id}` === id);
        if (local) {
          setPlaylist(local);
          setName(local.name);
          setUrl(local.url);
          setGenre(local.genre ?? "");
          setThumbnail(local.thumbnail ?? "");
          setType(local.type);
          const tracksList = getPlaylistTracks(local);
          setTracks(tracksList);
          setOrder(local.order ?? tracksList.map((t) => t.id));
        } else {
          setPlaylist(null);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!playlist) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = { name, url, genre, thumbnail, type };
      if (tracks.length >= 1) {
        payload.tracks = tracks;
        payload.order = order;
      }
      const res = await fetch(`/api/playlists/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        router.push(returnTo);
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveError((err as { error?: string }).error ?? "Failed to save playlist");
      }
    } catch {
      setSaveError("Failed to save playlist");
    } finally {
      setSaving(false);
    }
  }

  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    setDraggedIndex(null);
    if (draggedIndex === null || draggedIndex === dropIndex) return;
    const newOrder = [...order];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, removed);
    setOrder(newOrder);
  }

  function moveTrack(from: number, direction: 1 | -1) {
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    const newOrder = [...order];
    [newOrder[from], newOrder[to]] = [newOrder[to], newOrder[from]];
    setOrder(newOrder);
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-6 sm:p-8 text-center text-slate-500 min-h-[120px] flex items-center justify-center">
        Loading…
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-6 sm:p-8 text-center">
        <p className="text-slate-400">Playlist not found</p>
        <Link href={returnTo} className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-sky-400 hover:bg-slate-800/80 touch-manipulation">
          {returnTo === "/mobile" ? "Back to Player" : "Back to Playlists"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 sm:space-y-6 px-4 sm:px-0 pb-8">
      <div>
        <Link href={returnTo} className="inline-flex min-h-[44px] items-center text-sm text-slate-500 hover:text-slate-300 touch-manipulation -ml-1 px-1">
          ← {returnTo === "/mobile" ? "Player" : "Playlists"}
        </Link>
        <h1 className="mt-2 text-lg sm:text-xl font-semibold text-slate-50">Edit playlist</h1>
      </div>
      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4 sm:p-6 space-y-4 min-w-0">
        <div>
          <label className="block text-xs font-medium text-slate-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Genre</label>
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PlaylistType)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          >
            <option value="youtube">YouTube</option>
            <option value="soundcloud">SoundCloud</option>
            <option value="spotify">Spotify</option>
            <option value="winamp">Winamp</option>
            <option value="local">Local</option>
            <option value="stream-url">Stream URL</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Thumbnail URL</label>
          <input
            value={thumbnail}
            onChange={(e) => setThumbnail(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-50 touch-manipulation"
          />
        </div>
        {tracks.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-400">Tracks (reorder)</label>
            <p className="mt-0.5 text-[11px] text-slate-500 sm:hidden">Use ↑↓ to reorder on mobile</p>
            <div className="mt-2 max-h-[40vh] overflow-y-auto space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-2">
              {order
                .map((tid) => tracks.find((t) => t.id === tid))
                .filter(Boolean)
                .map((track, idx) => (
                  <div
                    key={track!.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, idx)}
                    className={`flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2.5 sm:py-2 min-h-[48px] ${
                      draggedIndex === idx ? "opacity-50" : ""
                    }`}
                  >
                    <span className="hidden sm:inline cursor-grab text-slate-500 select-none" aria-hidden>
                      ⋮⋮
                    </span>
                    <div className="flex sm:hidden shrink-0 gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveTrack(idx, -1)}
                        disabled={idx === 0}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/80 text-slate-400 disabled:opacity-40 disabled:pointer-events-none touch-manipulation"
                        aria-label="Move up"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 15l-6-6-6 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTrack(idx, 1)}
                        disabled={idx === order.length - 1}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/80 text-slate-400 disabled:opacity-40 disabled:pointer-events-none touch-manipulation"
                        aria-label="Move down"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-200">{track!.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{track!.type}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
        {saveError && (
          <p className="text-sm text-rose-400">{saveError}</p>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] rounded-xl bg-[#1db954] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1ed760] disabled:opacity-50 touch-manipulation"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Link
            href={returnTo}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 touch-manipulation"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
