"use client";

import { useState, useCallback } from "react";
import { inferPlaylistType, getYouTubeThumbnail } from "@/lib/playlist-utils";
import type { PlaylistType } from "@/lib/playlist-types";
import { useTranslations } from "@/lib/locale-context";

const PLAYLIST_TYPES: PlaylistType[] = ["youtube", "soundcloud", "spotify", "winamp", "local", "stream-url"];

type Props = {
  onAdd: (playlist: { id: string; name: string; genre: string; type: PlaylistType; url: string; thumbnail: string; createdAt: string }) => void;
};

async function fetchMetadata(url: string): Promise<{ title: string; genre: string; cover: string | null; type: string }> {
  try {
    const res = await fetch(`/api/playlists/metadata?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || "Untitled",
        genre: data.genre || "Mixed",
        cover: data.cover || null,
        type: data.type || inferPlaylistType(url),
      };
    }
  } catch {
    // fallback
  }
  const type = inferPlaylistType(url);
  const cover = type === "youtube" ? getYouTubeThumbnail(url) : null;
  return {
    title: type === "youtube" ? "YouTube video" : type === "soundcloud" ? "SoundCloud track" : "Untitled",
    genre: "Mixed",
    cover,
    type,
  };
}

export function AddPlaylistForm({ onAdd }: Props) {
  const { t } = useTranslations();
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualType, setManualType] = useState<PlaylistType>("youtube");
  const [manualGenre, setManualGenre] = useState("");
  const [manualCover, setManualCover] = useState("");
  const [genrePromptOpen, setGenrePromptOpen] = useState(false);
  const [genrePromptValue, setGenrePromptValue] = useState("");
  const [pendingCreate, setPendingCreate] = useState<{ name: string; url: string; type: string; cover: string } | null>(null);

  const createPlaylist = useCallback(
    async (data: { name: string; url: string; genre: string; type: string; thumbnail: string }) => {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          url: data.url,
          genre: data.genre || "Mixed",
          type: data.type,
          thumbnail: data.thumbnail || "",
        }),
      });
      if (res.ok) {
        const created = await res.json();
        onAdd(created);
      }
    },
    [onAdd],
  );

  const handleAddFromUrl = useCallback(
    async (u: string) => {
      const trimmed = u.trim();
      if (!trimmed) return;
      setSearching(true);
      try {
        const meta = await fetchMetadata(trimmed);
        setSearchQuery("");
        if (!meta.genre || meta.genre === "Mixed") {
          setPendingCreate({
            name: meta.title,
            url: trimmed,
            type: meta.type,
            cover: meta.cover || "",
          });
          setGenrePromptValue("");
          setGenrePromptOpen(true);
        } else {
          await createPlaylist({
            name: meta.title,
            url: trimmed,
            genre: meta.genre,
            type: meta.type,
            thumbnail: meta.cover || "",
          });
        }
      } finally {
        setSearching(false);
      }
    },
    [createPlaylist],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const text = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text/uri-list");
      if (!text.trim()) return;
      await handleAddFromUrl(text.trim());
    },
    [handleAddFromUrl],
  );

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleAddFromUrl(searchQuery);
  };

  const handleManualSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = manualName.trim();
      const url = manualUrl.trim();
      if (!name || !url) return;
      setSearching(true);
      try {
        await createPlaylist({
          name,
          url,
          genre: manualGenre.trim() || "Mixed",
          type: manualType,
          thumbnail: manualCover.trim(),
        });
        setManualName("");
        setManualUrl("");
        setManualGenre("");
        setManualCover("");
        setShowManual(false);
      } finally {
        setSearching(false);
      }
    },
    [manualName, manualUrl, manualGenre, manualType, manualCover, createPlaylist],
  );

  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/30 backdrop-blur-sm">
      {/* Prominent search bar - Tesla-style */}
      <form onSubmit={handleSearchSubmit} className="border-b border-slate-800/60 p-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.playlistSearchPlaceholder ?? "Paste YouTube, SoundCloud, Spotify, or M3U URL…"}
              className="w-full rounded-2xl border-0 bg-slate-800/80 py-3.5 pl-12 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:ring-2 focus:ring-slate-500/40"
            />
          </div>
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="rounded-2xl bg-slate-700 px-6 py-3.5 text-sm font-medium text-slate-100 transition hover:bg-slate-600 disabled:opacity-40"
          >
            {searching ? (t.adding ?? "Adding…") : (t.add ?? "Add")}
          </button>
        </div>
      </form>

      {/* Integrated drag area - smaller, inviting */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        className={`flex items-center justify-center gap-2 px-4 py-3 transition ${
          dragOver ? "bg-emerald-500/10" : "bg-slate-800/20"
        }`}
      >
        <span className="text-slate-500">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </span>
        <p className="text-xs text-slate-500">
          {dragOver ? (t.dropToAdd ?? "Drop to add") : (t.dragUrlText ?? "Drag a YouTube, SoundCloud, Spotify, or M3U URL here to create a playlist")}
        </p>
      </div>

      {/* Manual addition toggle */}
      <div className="border-t border-slate-800/60">
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-slate-400 hover:bg-slate-800/30 hover:text-slate-200"
        >
          <span>{t.addManually ?? "Add manually"}</span>
          <span className="text-slate-500">{showManual ? "−" : "+"}</span>
        </button>
        {showManual && (
          <form onSubmit={handleManualSubmit} className="space-y-3 border-t border-slate-800/60 p-4">
            <input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder={t.name ?? "Name"}
              required
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <input
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="URL"
              required
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <select
              value={manualType}
              onChange={(e) => setManualType(e.target.value as PlaylistType)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              {PLAYLIST_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {ty}
                </option>
              ))}
            </select>
            <input
              value={manualGenre}
              onChange={(e) => setManualGenre(e.target.value)}
              placeholder="Genre (optional)"
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <input
              value={manualCover}
              onChange={(e) => setManualCover(e.target.value)}
              placeholder="Cover URL (optional)"
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={searching}
              className="w-full rounded-xl bg-[#1db954] px-4 py-2 text-sm font-medium text-white hover:bg-[#1ed760] disabled:opacity-50"
            >
              {searching ? (t.adding ?? "Adding…") : (t.add ?? "Add")}
            </button>
          </form>
        )}
      </div>

      {genrePromptOpen && pendingCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-100">Add genre</h3>
            <p className="mt-1 text-xs text-slate-500">
              Enter a genre (e.g. Lofi, Ambient). Default: Mixed.
            </p>
            <input
              value={genrePromptValue}
              onChange={(e) => setGenrePromptValue(e.target.value)}
              placeholder="Genre"
              className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void createPlaylist({
                    ...pendingCreate,
                    genre: genrePromptValue.trim() || "Mixed",
                    thumbnail: pendingCreate.cover,
                  });
                  setPendingCreate(null);
                  setGenrePromptOpen(false);
                }
                if (e.key === "Escape") {
                  setPendingCreate(null);
                  setGenrePromptOpen(false);
                }
              }}
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void createPlaylist({
                    ...pendingCreate,
                    genre: genrePromptValue.trim() || "Mixed",
                    thumbnail: pendingCreate.cover,
                  });
                  setPendingCreate(null);
                  setGenrePromptOpen(false);
                }}
                className="flex-1 rounded-xl bg-[#1db954] px-4 py-2 text-sm font-medium text-white hover:bg-[#1ed760]"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  void createPlaylist({
                    ...pendingCreate,
                    genre: "Mixed",
                    thumbnail: pendingCreate.cover,
                  });
                  setPendingCreate(null);
                  setGenrePromptOpen(false);
                }}
                className="flex-1 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
