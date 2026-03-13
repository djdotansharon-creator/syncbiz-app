"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { inferPlaylistType } from "@/lib/playlist-utils";
import type { UnifiedSource } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";
import type { RadioStream } from "@/lib/source-types";

type ParseResult = {
  title: string;
  cover: string | null;
  genre: string;
  type: string;
  isRadio: boolean;
  viewCount?: number;
  artist?: string;
  song?: string;
};

async function searchYouTube(q: string): Promise<{ title: string; url: string; cover: string | null; type?: string; viewCount?: number }[]> {
  if (!q.trim() || q.length < 2) return [];
  const res = await fetch(`/api/sources/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return data.results || [];
}

async function parseUrl(url: string): Promise<ParseResult | null> {
  const res = await fetch("/api/sources/parse-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) return null;
  return res.json();
}

type Props = {
  onAdd: (source: UnifiedSource) => void;
};

export function UrlIngestZone({ onAdd }: Props) {
  const router = useRouter();
  const { t } = useTranslations();
  const [inputValue, setInputValue] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingestUrl = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;

      setIngesting(true);
      setError(null);
      try {
        const parsed = await parseUrl(trimmed);
        if (!parsed) {
          setError("Could not parse URL");
          return;
        }

        const type = inferPlaylistType(trimmed);
        const isRadio =
          parsed.isRadio ||
          type === "winamp" ||
          trimmed.match(/\.(m3u8?|pls|aac|mp3)(\?|$)/i);
        const isShazam = parsed.type === "shazam";

        if (isShazam) {
          const searchQuery =
            parsed?.artist && parsed?.song
              ? `${parsed.artist} ${parsed.song}`
              : parsed?.title ?? "";
          const ytResults = await searchYouTube(searchQuery);
          const first = ytResults.find((r) => r.type === "youtube") ?? ytResults[0];
          if (!first) {
            setError("Could not find song on YouTube");
            return;
          }
          const res = await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: parsed?.title ?? "Untitled",
              url: first.url,
              genre: parsed?.genre ?? "Mixed",
              type: "youtube",
              thumbnail: first.cover || (parsed?.cover ?? ""),
              viewCount: first.viewCount,
            }),
          });
          if (res.ok) {
            const created = (await res.json()) as Playlist;
            onAdd({
              id: `pl-${created.id}`,
              title: created.name,
              genre: created.genre || "Mixed",
              cover: created.thumbnail || null,
              type: "youtube",
              url: created.url,
              origin: "playlist",
              playlist: created,
            });
            setInputValue("");
            router.refresh();
          } else {
            setError("Failed to add");
          }
        } else if (isRadio) {
          const res = await fetch("/api/radio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: parsed?.title ?? "Untitled",
              url: trimmed,
              genre: parsed?.genre ?? "Mixed",
              cover: parsed?.cover ?? null,
            }),
          });
          if (res.ok) {
            const station = (await res.json()) as RadioStream;
            onAdd({
              id: station.id,
              title: station.name,
              genre: station.genre || "Live Radio",
              cover: station.cover || null,
              type: "stream-url",
              url: station.url,
              origin: "radio",
              radio: station,
            });
            setInputValue("");
            router.refresh();
          } else {
            setError("Failed to add radio station");
          }
        } else {
          const res = await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: parsed?.title ?? "Untitled",
              url: trimmed,
              genre: parsed?.genre ?? "Mixed",
              type: parsed?.type ?? "stream-url",
              thumbnail: parsed?.cover ?? "",
              viewCount: parsed?.viewCount,
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
            setInputValue("");
            router.refresh();
          } else {
            setError("Failed to add playlist");
          }
        }
      } catch {
        setError("Failed to add");
      } finally {
        setIngesting(false);
      }
    },
    [onAdd, router]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void ingestUrl(inputValue);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const text =
        e.dataTransfer.getData("text/plain") ||
        e.dataTransfer.getData("text/uri-list"); 
      if (text?.trim()) void ingestUrl(text.trim());
    },
    [ingestUrl]
  );

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      className={`rounded-xl border-2 border-dashed transition-all ${
        dragOver
          ? "border-[#1ed760]/60 bg-[#1ed760]/5"
          : "border-slate-700/80 bg-slate-900/40"
      }`}
    >
      <form onSubmit={handleSubmit} className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </span>
            <input
              type="url"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={t.dragUrlText ?? "Paste or drop YouTube, SoundCloud, Spotify, Radio URL…"}
              disabled={ingesting}
              className="w-full rounded-xl border border-slate-700/80 bg-slate-800/80 py-2.5 pl-11 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#1ed760]/50 focus:ring-2 focus:ring-[#1ed760]/30 focus:outline-none disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={ingesting || !inputValue.trim()}
            className="shrink-0 rounded-xl bg-gradient-to-b from-[#1ed760] to-[#1db954] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_0_2px_rgba(29,185,84,0.3),0_4px_12px_rgba(29,185,84,0.3)] transition hover:from-[#2ee770] hover:to-[#1ed760] hover:shadow-[0_0_0_2px_rgba(30,215,96,0.4),0_6px_16px_rgba(30,215,96,0.4)] disabled:opacity-40 disabled:pointer-events-none"
          >
            {ingesting ? t.adding ?? "Adding…" : t.add ?? "Add"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {dragOver ? (t.dropToAdd ?? "Drop to add") : (t.dragUrlText ?? "Paste or drag a URL to add")}
        </p>
        {error && (
          <p className="mt-2 text-xs text-amber-400">{error}</p>
        )}
      </form>
    </div>
  );
}
