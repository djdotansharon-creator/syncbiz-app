"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "@/lib/locale-context";
import { inferPlaylistType, getYouTubeThumbnail } from "@/lib/playlist-utils";
import { formatViewCount } from "@/lib/format-utils";
import { inferGenre } from "@/lib/infer-genre";
import type { UnifiedSource } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";

type SearchResult = { title: string; url: string; cover: string | null; type: "youtube" | "soundcloud"; viewCount?: number; durationSeconds?: number };

async function fetchMetadata(url: string): Promise<{ title: string; genre: string; cover: string | null; type: string; viewCount?: number; durationSeconds?: number }> {
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
    /* fallback */
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

type Props = {
  onAdd: (source: UnifiedSource) => void;
};

export function AddSourceForm({ onAdd }: Props) {
  const { t } = useTranslations();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [genrePrompt, setGenrePrompt] = useState<{ title: string; url: string; cover: string; type: string } | null>(null);

  const createFromUrl = useCallback(
    async (url: string, opts?: string | { genreOverride?: string; viewCount?: number; durationSeconds?: number }) => {
      const meta = await fetchMetadata(url);
      const genreOverride = typeof opts === "string" ? opts : opts?.genreOverride;
      const viewCount = typeof opts === "object" && opts != null && opts.viewCount != null ? opts.viewCount : undefined;
      const durationSeconds = typeof opts === "object" && opts != null && opts.durationSeconds != null ? opts.durationSeconds : undefined;
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: meta.title,
          url,
          genre: genreOverride ?? meta.genre ?? "Mixed",
          type: meta.type,
          thumbnail: meta.cover || "",
          viewCount,
          durationSeconds,
        }),
      });
      if (res.ok) {
        const created = (await res.json()) as Playlist;
        onAdd({
          id: `pl-${created.id}`,
          title: created.name,
          genre: created.genre || "Mixed",
          cover: created.thumbnail || null,
          type: created.type as UnifiedSource["type"],
          url: created.url,
          origin: "playlist",
          playlist: created,
        });
      }
    },
    [onAdd],
  );

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(`/api/sources/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const handleAddFromSearch = useCallback(
    async (r: SearchResult) => {
      setSearching(true);
      try {
        await createFromUrl(r.url, {
          genreOverride: inferGenre(r.title, searchQuery),
          viewCount: r.viewCount,
          durationSeconds: r.durationSeconds,
        });
        setSearchQuery("");
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [createFromUrl, searchQuery],
  );

  const handleAddFromUrl = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      setSearching(true);
      try {
        const meta = await fetchMetadata(trimmed);
        if (!meta.genre || meta.genre === "Mixed") {
          setGenrePrompt({ title: meta.title, url: trimmed, cover: meta.cover || "", type: meta.type });
        } else {
          await createFromUrl(trimmed, meta.genre);
        }
      } finally {
        setSearching(false);
      }
    },
    [createFromUrl],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const text = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text/uri-list");
      if (text.trim()) void handleAddFromUrl(text.trim());
    },
    [handleAddFromUrl],
  );

  return (
    <div className="rounded-2xl border border-slate-700/80 bg-slate-900/40 shadow-[0_0_0_1px_rgba(30,215,96,0.1)] backdrop-blur-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSearch();
        }}
        className="border-b border-slate-800/60 p-4"
      >
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
              placeholder={t.searchPlaceholder ?? "Search YouTube (e.g. George Michael) or paste URL…"}
              className="w-full rounded-2xl border border-slate-700/80 bg-slate-800/80 py-3.5 pl-12 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#1db954]/50 focus:ring-2 focus:ring-[#1db954]/30"
            />
          </div>
          <button type="submit" disabled={searching || !searchQuery.trim()} className="rounded-2xl bg-gradient-to-b from-[#1ed760] to-[#1db954] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_0_0_2px_rgba(29,185,84,0.3),0_4px_14px_rgba(29,185,84,0.4)] transition hover:from-[#2ee770] hover:to-[#1ed760] hover:shadow-[0_0_0_2px_rgba(30,215,96,0.4),0_6px_20px_rgba(30,215,96,0.5)] disabled:opacity-40">
            {searching ? t.searching : t.search}
          </button>
        </div>
      </form>

      {searchResults.length > 0 && (
        <div className="border-b border-slate-800/60 p-4">
          <p className="mb-2 text-xs font-medium text-slate-500">{t.clickToAdd}</p>
          <div className="flex flex-wrap gap-2">
            {searchResults.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => void handleAddFromSearch(r)}
                disabled={searching}
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-700/80 disabled:opacity-50"
              >
                {r.cover && <img src={r.cover} alt="" className="h-8 w-8 rounded object-cover" />}
                <span className="flex min-w-0 flex-col">
                  <span className="max-w-[200px] truncate">{r.title}</span>
                  <span className="text-[10px] text-slate-500">
                    {(() => {
                      const g = inferGenre(r.title, searchQuery);
                      const parts: string[] = [];
                      if (g && g !== "Mixed") parts.push(g);
                      if (r.viewCount != null) parts.push(`${formatViewCount(r.viewCount)} ${t.views ?? "views"}`);
                      return parts.join(" • ") || null;
                    })()}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        className={`flex items-center justify-center gap-2 px-4 py-3 transition ${dragOver ? "bg-emerald-500/10" : "bg-slate-800/20"}`}
      >
        <span className="text-slate-500">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </span>
        <p className="text-xs text-slate-500">
          {dragOver ? "Drop to add" : "Or drag a YouTube, SoundCloud, Spotify, or M3U URL here to create a source"}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const url = (e.currentTarget.elements.namedItem("url") as HTMLInputElement)?.value?.trim();
          if (url) void handleAddFromUrl(url);
        }}
        className="border-t border-slate-800/60 p-4"
      >
        <p className="mb-2 text-xs text-slate-500">{t.pasteUrlDirectly}</p>
        <div className="flex gap-2">
          <input name="url" type="url" placeholder="https://..." className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" />
          <button type="submit" disabled={searching} className="rounded-xl bg-[#1db954] px-4 py-2 text-sm font-medium text-white hover:bg-[#1ed760] disabled:opacity-50">
            {t.add}
          </button>
        </div>
      </form>

      {genrePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-100">{t.addGenre}</h3>
            <p className="mt-1 text-xs text-slate-500">{t.addGenreDescription}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const genre = (e.currentTarget.elements.namedItem("genre") as HTMLInputElement)?.value?.trim() || "Mixed";
                void createFromUrl(genrePrompt.url, genre);
                setGenrePrompt(null);
              }}
              className="mt-4 space-y-3"
            >
              <input name="genre" placeholder={t.genre} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" autoFocus />
              <div className="flex gap-2">
                <button type="submit" className="flex-1 rounded-xl bg-[#1db954] px-4 py-2 text-sm font-medium text-white hover:bg-[#1ed760]">
                  {t.add}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void createFromUrl(genrePrompt.url, "Mixed");
                    setGenrePrompt(null);
                  }}
                  className="flex-1 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800"
                >
                  {t.skip}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
