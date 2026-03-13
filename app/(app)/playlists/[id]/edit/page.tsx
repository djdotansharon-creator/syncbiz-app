"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import type { Playlist, PlaylistType, PlaylistTrack } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";

export default function EditPlaylistPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
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
      .catch(() => setPlaylist(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!playlist) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = { name, url, genre, thumbnail, type };
      if (tracks.length > 1) {
        payload.tracks = tracks;
        payload.order = order;
      }
      const res = await fetch(`/api/playlists/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        router.push("/playlists");
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

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-8 text-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-8 text-center">
        <p className="text-slate-400">Playlist not found</p>
        <Link href="/playlists" className="mt-4 inline-block text-sm text-sky-400 hover:underline">
          Back to Playlists
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/playlists" className="text-sm text-slate-500 hover:text-slate-300">← Playlists</Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-50">Edit playlist</h1>
      </div>
      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Genre</label>
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PlaylistType)}
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50"
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
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-50"
          />
        </div>
        {tracks.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-400">Tracks (drag to reorder)</label>
            <div className="mt-2 space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-2">
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
                    className={`flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2 ${
                      draggedIndex === idx ? "opacity-50" : ""
                    }`}
                  >
                    <span className="cursor-grab text-slate-500" aria-hidden>
                      ⋮⋮
                    </span>
                    <span className="flex-1 truncate text-sm text-slate-200">{track!.name}</span>
                    <span className="text-xs text-slate-500">{track!.type}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
        {saveError && (
          <p className="text-sm text-rose-400">{saveError}</p>
        )}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-[#1db954] px-4 py-2 text-sm font-medium text-white hover:bg-[#1ed760] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Link
            href="/playlists"
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
