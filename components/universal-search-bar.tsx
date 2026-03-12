"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { useSourcesPlayback } from "@/lib/sources-playback-context";
import { ActionButtonPlay, ActionButtonEdit } from "@/components/ui/action-buttons";
import { inferPlaylistType, getYouTubeThumbnail } from "@/lib/playlist-utils";
import { formatViewCount } from "@/lib/format-utils";
import { inferGenre } from "@/lib/infer-genre";
import { getPlaylistTracks } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";

type YouTubeResult = { title: string; url: string; cover: string | null; type: "youtube" | "soundcloud"; viewCount?: number };

function searchLocal(sources: UnifiedSource[], query: string): UnifiedSource[] {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];
  return sources.filter((s) => {
    if (s.title.toLowerCase().includes(q)) return true;
    if (s.genre?.toLowerCase().includes(q)) return true;
    if (s.type.toLowerCase().includes(q)) return true;
    if (s.playlist) {
      const tracks = getPlaylistTracks(s.playlist);
      if (tracks.some((t) => (t.name || t.title || "").toLowerCase().includes(q))) return true;
    }
    return false;
  });
}

async function searchYouTube(q: string): Promise<YouTubeResult[]> {
  if (!q.trim() || q.length < 2) return [];
  const res = await fetch(`/api/sources/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return data.results || [];
}

async function createPlaylistFromUrl(
  url: string,
  meta?: { title: string; genre: string; cover: string | null; type: string; viewCount?: number }
): Promise<Playlist | null> {
  const type = meta?.type || inferPlaylistType(url);
  const cover = meta?.cover || (type === "youtube" ? getYouTubeThumbnail(url) : null);
  const res = await fetch("/api/playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: meta?.title || "Untitled",
      url,
      genre: meta?.genre || "Mixed",
      type,
      thumbnail: cover || "",
      viewCount: meta?.viewCount,
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

function SourceLogo({ type, origin, size = "sm" }: { type: UnifiedSource["type"]; origin?: UnifiedSource["origin"]; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const color =
    type === "youtube" ? "text-[#ff0000]" : type === "soundcloud" ? "text-[#ff5500]" : type === "spotify" ? "text-[#1db954]" : "text-slate-300";
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
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02z" />
        </svg>
      )}
      {origin === "radio" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${sizeClass} text-rose-400`}>
          <path d="M4 9a5 5 0 0 1 5 5v1h6v-1a5 5 0 0 1 5-5" />
          <path d="M4 14h16" />
          <circle cx="12" cy="18" r="2" />
        </svg>
      )}
      {(type === "local" || type === "winamp" || type === "stream-url") && origin !== "radio" && (
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

type Props = {
  onAddSource: (source: UnifiedSource) => void;
};

export function UniversalSearchBar({ onAddSource }: Props) {
  const router = useRouter();
  const { t } = useTranslations();
  const { sources, setSources } = useSourcesPlayback();
  const { playSource } = usePlayback();
  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<UnifiedSource[]>([]);
  const [youtubeResults, setYoutubeResults] = useState<YouTubeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const hasQuery = query.trim().length >= 2;
  const hasLocal = localResults.length > 0;
  const hasYoutube = youtubeResults.length > 0;
  const hasResults = hasLocal || hasYoutube;

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setLocalResults([]);
      setYoutubeResults([]);
      return;
    }
    setSearching(true);
    const local = searchLocal(sources, q);
    setLocalResults(local);
    if (local.length > 0) {
      setYoutubeResults([]);
      setSearching(false);
      return;
    }
    try {
      const yt = await searchYouTube(q);
      setYoutubeResults(yt);
    } finally {
      setSearching(false);
    }
  }, [query, sources]);

  useEffect(() => {
    if (!hasQuery) {
      setLocalResults([]);
      setYoutubeResults([]);
      setShowResults(false);
      return;
    }
    const id = setTimeout(runSearch, 300);
    return () => clearTimeout(id);
  }, [query, runSearch, hasQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) && inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleVoiceSearch = useCallback(() => {
    const Win = typeof window !== "undefined" ? window : null;
    const SR = Win && ((Win as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (Win as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
    if (!SR || typeof SR !== "function") return;
    const rec = new (SR as new () => Record<string, unknown>)();
    (rec as Record<string, unknown>).continuous = false;
    (rec as Record<string, unknown>).interimResults = false;
    (rec as Record<string, unknown>).lang = "en-US";
    setListening(true);
    (rec as Record<string, unknown>).onresult = (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => {
      const t = e.results[0]?.[0]?.transcript ?? "";
      setQuery(t);
      setShowResults(true);
      setListening(false);
    };
    (rec as Record<string, unknown>).onerror = () => setListening(false);
    (rec as Record<string, unknown>).onend = () => setListening(false);
    (rec as { start: () => void }).start();
  }, []);

  const voiceSupported =
    typeof window !== "undefined" &&
    (!!(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const handleAddYoutube = useCallback(
    async (r: YouTubeResult) => {
      const genre = inferGenre(r.title, query);
      const meta = { title: r.title, genre, cover: r.cover, type: r.type, viewCount: r.viewCount };
      const created = await createPlaylistFromUrl(r.url, meta);
      if (created) {
        const unified: UnifiedSource = {
          id: `pl-${created.id}`,
          title: created.name,
          genre: created.genre || genre,
          cover: created.thumbnail || null,
          type: created.type as UnifiedSource["type"],
          url: created.url,
          origin: "playlist",
          playlist: created,
        };
        onAddSource(unified);
        router.refresh();
        setQuery("");
        setYoutubeResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [onAddSource, router, query]
  );

  const handlePlayYoutube = useCallback(
    async (r: YouTubeResult) => {
      const genre = inferGenre(r.title, query);
      const created = await createPlaylistFromUrl(r.url, { title: r.title, genre, cover: r.cover, type: r.type });
      if (created) {
        const u: UnifiedSource = {
          id: `pl-${created.id}`,
          title: created.name,
          genre: created.genre || genre,
          cover: created.thumbnail || null,
          type: "youtube",
          url: created.url,
          origin: "playlist",
          playlist: created,
        };
        onAddSource(u);
        playSource(u);
        router.refresh();
        setQuery("");
        setYoutubeResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [playSource, router, onAddSource, query]
  );

  return (
    <div className="relative" ref={panelRef}>
      <div
        className={`flex items-center gap-2 rounded-2xl border-2 border-slate-700/80 bg-slate-900/95 shadow-[0_0_0_1px_rgba(30,215,96,0.1),0_0_20px_rgba(0,0,0,0.2)] transition-all duration-200 focus-within:border-[#1ed760]/50 focus-within:shadow-[0_0_0_2px_rgba(30,215,96,0.3),0_0_24px_rgba(30,215,96,0.15)] ${
          showResults && hasResults ? "rounded-b-none border-b-0" : ""
        }`}
      >
        <span className="pl-4 text-slate-500">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => hasQuery && setShowResults(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
              setShowResults(true);
            }
          }}
          placeholder={t.universalSearchPlaceholder ?? "Search library or find on YouTube…"}
          className="min-h-[48px] flex-1 bg-transparent py-3 pr-2 text-base text-slate-100 placeholder:text-slate-500 focus:outline-none"
          aria-label={t.search}
          autoComplete="off"
        />
        {voiceSupported && (
          <button
            type="button"
            onClick={handleVoiceSearch}
            disabled={listening}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 transition-all duration-200 ${
              listening
                ? "border-[#1ed760]/60 bg-slate-900/90 text-[#1ed760] shadow-[0_0_0_2px_rgba(30,215,96,0.4),0_0_20px_rgba(30,215,96,0.25)]"
                : "border-[#1ed760]/40 bg-slate-800/80 text-slate-400 hover:border-[#1ed760]/60 hover:text-[#1ed760] hover:shadow-[0_0_20px_rgba(30,215,96,0.15)]"
            }`}
            title={t.voiceSearch}
            aria-label={t.voiceSearch}
          >
            <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )}
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setLocalResults([]);
              setYoutubeResults([]);
              setShowResults(false);
              inputRef.current?.focus();
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-700/80 hover:text-slate-200"
            aria-label="Clear"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {showResults && hasQuery && (
        <div className="absolute left-0 right-0 top-full z-50 max-h-[70vh] overflow-y-auto rounded-b-2xl border border-t-0 border-slate-700/80 bg-slate-900/98 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md">
          {searching && !hasResults ? (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
              <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {t.searching}
            </div>
          ) : (
            <>
              {hasLocal && (
                <div className="border-b border-slate-800/60 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t.localResults}</p>
                  <div className="space-y-1">
                    {localResults.map((source) => (
                      <div
                        key={source.id}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-slate-800/80"
                      >
                        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-800">
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
                          <div className="absolute bottom-0 right-0 p-0.5">
                            <SourceLogo type={source.type} origin={source.origin} size="sm" />
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-100">{source.title}</p>
                          {source.genre && <p className="text-xs text-slate-500">{source.genre}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <ActionButtonPlay onClick={() => playSource(source)} size="sm" title={t.play} aria-label={t.play} />
                          {source.origin === "playlist" && source.playlist && (
                            <ActionButtonEdit href={`/playlists/${source.playlist.id}/edit`} variant="player" title={t.edit} aria-label={t.edit} />
                          )}
                          {source.origin === "source" && source.source && (
                            <ActionButtonEdit href={`/sources/${source.source.id}/edit`} variant="player" title={t.edit} aria-label={t.edit} />
                          )}
                          {source.origin === "radio" && source.radio && (
                            <ActionButtonEdit href={`/radio/${source.radio.id}/edit`} variant="player" title={t.edit} aria-label={t.edit} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasYoutube && (
                <div className="p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t.youtubeResults}</p>
                  <div className="space-y-1">
                    {youtubeResults.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-slate-800/80">
                        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                          {r.cover ? (
                            <img src={r.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-slate-500">
                              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" />
                              </svg>
                            </div>
                          )}
                          <span className="absolute bottom-0 right-0 rounded bg-[#ff0000]/90 px-1 py-0.5 text-[10px] font-medium text-white">YT</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-100">{r.title}</p>
                          <p className="text-xs text-slate-500">
                            YouTube
                            {(() => {
                              const g = inferGenre(r.title, query);
                              return g && g !== "Mixed" ? <span className="ml-1.5 text-slate-400">• {g}</span> : null;
                            })()}
                            {r.viewCount != null && (
                              <span className="ml-1.5 text-slate-400">
                                • {formatViewCount(r.viewCount)} {t.views ?? "views"}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleAddYoutube(r)}
                            className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-600 bg-slate-800/90 px-3 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
                          >
                            {t.addToLibrary}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePlayYoutube(r)}
                            className="inline-flex h-9 items-center justify-center rounded-xl bg-[#1db954] px-3 text-xs font-semibold text-white transition hover:bg-[#1ed760]"
                          >
                            {t.playNow}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!searching && hasQuery && !hasResults && (
                <div className="py-8 text-center text-sm text-slate-500">
                  {t.noSearchResults}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
