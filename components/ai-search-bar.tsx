"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { inferPlaylistType, getYouTubeVideoId, getYouTubeThumbnail } from "@/lib/playlist-utils";
import { formatViewCount } from "@/lib/format-utils";
import { inferGenre } from "@/lib/infer-genre";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { ActionButtonEdit } from "@/components/ui/action-buttons";
import type { UnifiedSource } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";

type YouTubeResult = { title: string; url: string; cover: string | null; type: "youtube" | "soundcloud"; viewCount?: number };

/** Normalize URL for duplicate detection (extract video/playlist ID where possible). */
function normalizeUrlForCompare(url: string): string {
  const u = url.trim().toLowerCase();
  const ytId = getYouTubeVideoId(url);
  if (ytId) return `yt:${ytId}`;
  if (u.includes("youtube.com/playlist")) {
    const m = u.match(/list=([^&\s]+)/);
    return m ? `ytpl:${m[1]}` : u;
  }
  if (u.includes("soundcloud.com")) {
    const m = u.match(/soundcloud\.com\/[^/]+\/[^/?#]+/);
    return m ? m[0] : u;
  }
  return u;
}

function searchLocal(sources: UnifiedSource[], query: string): UnifiedSource[] {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  return sources.filter((s) => {
    const title = s.title.toLowerCase();
    const genre = (s.genre ?? "").toLowerCase();
    const type = s.type.toLowerCase();
    const radioName = s.origin === "radio" && s.radio?.name ? s.radio.name.toLowerCase() : "";
    let searchable = `${title} ${genre} ${type} ${radioName}`;
    if (s.playlist) {
      const tracks = getPlaylistTracks(s.playlist);
      const trackNames = tracks.map((t) => (t.name || (t as { title?: string }).title || "").toLowerCase()).join(" ");
      searchable += ` ${trackNames}`;
    }
    return words.some((w) => searchable.includes(w));
  });
}

function findDuplicateByUrl(sources: UnifiedSource[], url: string): UnifiedSource | null {
  const norm = normalizeUrlForCompare(url);
  return sources.find((s) => normalizeUrlForCompare(s.url) === norm) ?? null;
}

async function fetchSources(): Promise<UnifiedSource[]> {
  const res = await fetch("/api/sources/unified", { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
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

const inputBase =
  "h-10 w-full rounded-xl border border-slate-700/80 bg-slate-800/80 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-all focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/30 focus:outline-none";

export function AISearchBar() {
  const router = useRouter();
  const { t } = useTranslations();
  const { playSource } = usePlayback();

  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<UnifiedSource[]>([]);
  const [localResults, setLocalResults] = useState<UnifiedSource[]>([]);
  const [youtubeResults, setYoutubeResults] = useState<YouTubeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const unified = await fetchSources();
      setSources(unified);
      const local = searchLocal(unified, q);
      setLocalResults(local);
      const yt = await searchYouTube(q);
      setYoutubeResults(yt);
      if (local.length === 0 && yt.length === 0) {
        setError(t.noSearchResults ?? "No results in library or YouTube.");
      }
    } catch {
      setError(t.error ?? "Search failed. Try again.");
    } finally {
      setSearching(false);
    }
  }, [query, t.noSearchResults, t.error]);

  useEffect(() => {
    if (!hasQuery) {
      setLocalResults([]);
      setYoutubeResults([]);
      setShowResults(false);
      setError(null);
      return;
    }
    const id = setTimeout(runSearch, 300);
    return () => clearTimeout(id);
  }, [query, runSearch, hasQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleVoiceSearch = useCallback(() => {
    const Win = typeof window !== "undefined" ? window : null;
    const SR =
      Win &&
      ((Win as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
        (Win as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
    if (!SR || typeof SR !== "function") return;
    const rec = new (SR as new () => Record<string, unknown>)();
    (rec as Record<string, unknown>).continuous = false;
    (rec as Record<string, unknown>).interimResults = false;
    (rec as Record<string, unknown>).lang = "en-US";
    setListening(true);
    (rec as Record<string, unknown>).onresult = (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => {
      setQuery(e.results[0]?.[0]?.transcript ?? "");
      setShowResults(true);
      setListening(false);
    };
    (rec as Record<string, unknown>).onerror = () => setListening(false);
    (rec as Record<string, unknown>).onend = () => setListening(false);
    (rec as { start: () => void }).start();
  }, []);

  const voiceSupported =
    typeof window !== "undefined" &&
    (!!(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const handleAddYoutube = useCallback(
    async (r: YouTubeResult) => {
      const existing = findDuplicateByUrl(sources, r.url);
      if (existing) {
        router.push("/sources");
        router.refresh();
        setQuery("");
        setShowResults(false);
        return;
      }
      const genre = inferGenre(r.title, query);
      const created = await createPlaylistFromUrl(r.url, {
        title: r.title,
        genre,
        cover: r.cover,
        type: r.type,
        viewCount: r.viewCount,
      });
      if (created) {
        router.push("/sources");
        router.refresh();
        setQuery("");
        setYoutubeResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [sources, query, router]
  );

  const handlePlayYoutube = useCallback(
    async (r: YouTubeResult) => {
      const existing = findDuplicateByUrl(sources, r.url);
      if (existing) {
        playSource(existing);
        setQuery("");
        setShowResults(false);
        return;
      }
      const genre = inferGenre(r.title, query);
      const created = await createPlaylistFromUrl(r.url, {
        title: r.title,
        genre,
        cover: r.cover,
        type: r.type,
        viewCount: r.viewCount,
      });
      if (created) {
        const u: UnifiedSource = {
          id: `pl-${created.id}`,
          title: created.name,
          genre: created.genre || "Mixed",
          cover: created.thumbnail || null,
          type: "youtube",
          url: created.url,
          origin: "playlist",
          playlist: created,
        };
        playSource(u);
        router.push("/sources");
        router.refresh();
        setQuery("");
        setYoutubeResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [sources, query, playSource, router]
  );

  return (
    <div ref={panelRef} className="relative">
      <div
        className={`flex items-center gap-2 rounded-xl border transition-all ${
          showResults && hasResults
            ? "rounded-b-none border-b-0 border-slate-600/80 bg-slate-900/60"
            : "border-slate-700/80 bg-slate-900/50"
        }`}
      >
        <span className="pl-3 text-slate-500">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          placeholder={t.aiSearchPlaceholder ?? "Search library or find on YouTube… (e.g. Ayala Golani top hits)"}
          className={`${inputBase} flex-1 border-0 bg-transparent pl-0 pr-2 focus:ring-0`}
          aria-label={t.search}
          autoComplete="off"
        />
        {voiceSupported && (
          <button
            type="button"
            onClick={handleVoiceSearch}
            disabled={listening}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
              listening ? "text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.3)]" : "text-slate-400 hover:text-cyan-400"
            }`}
            title={t.voiceSearch}
            aria-label={t.voiceSearch}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
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
              setError(null);
              inputRef.current?.focus();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
            aria-label="Clear"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {showResults && hasQuery && (
        <div className="absolute left-0 right-0 top-full z-50 max-h-[60vh] overflow-y-auto rounded-b-xl border border-t-0 border-slate-700/80 bg-slate-900/98 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md">
          {searching && !hasResults ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {t.searching}
            </div>
          ) : error ? (
            <div className="space-y-3 px-4 py-6">
              <p className="text-sm text-amber-400">{error}</p>
              <p className="text-xs text-slate-500">{t.aiSearchSuggest ?? "Try different keywords, e.g. artist name, song title, or playlist."}</p>
            </div>
          ) : (
            <>
              {hasLocal && (
                <div className="border-b border-slate-800/60 p-2">
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.localResults}</p>
                  <div className="space-y-0.5">
                    {localResults.map((source) => (
                      <div
                        key={source.id}
                        className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80"
                      >
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                          {source.cover ? (
                            <img src={source.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-slate-500">
                              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M9 18V5l12-2v13" />
                                <circle cx="6" cy="18" r="3" />
                                <circle cx="18" cy="16" r="3" />
                              </svg>
                            </div>
                          )}
                          <span
                            className={`absolute bottom-0 right-0 rounded px-1 py-0.5 text-[9px] font-medium ${
                              source.type === "youtube" ? "bg-[#ff0000]/90 text-white" : "bg-slate-700 text-slate-300"
                            }`}
                          >
                            {source.type === "youtube" ? "YT" : source.type === "soundcloud" ? "SC" : ""}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{source.title}</p>
                          {source.genre && <p className="text-[10px] text-slate-500">{source.genre}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => playSource(source)}
                            className="inline-flex h-8 items-center justify-center rounded-lg bg-[#1db954] px-2.5 text-xs font-medium text-white transition hover:bg-[#1ed760]"
                          >
                            {t.play}
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push("/sources")}
                            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
                          >
                            {t.open}
                          </button>
                          {source.origin === "playlist" && source.playlist && (
                            <ActionButtonEdit href={`/playlists/${source.playlist.id}/edit`} variant="player" title={t.edit} aria-label={t.edit} />
                          )}
                          {source.origin === "radio" && source.radio && (
                            <ActionButtonEdit href={`/radio/${source.radio.id}/edit`} variant="player" title={t.edit} aria-label={t.edit} />
                          )}
                          {source.origin === "source" && source.source && (
                            <ActionButtonEdit href={`/sources/${source.source.id}/edit`} variant="player" title={t.edit} aria-label={t.edit} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasYoutube && (
                <div className="p-2">
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.youtubeResults}</p>
                  <div className="space-y-0.5">
                    {youtubeResults.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                          {r.cover ? (
                            <img src={r.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-slate-500">
                              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" />
                              </svg>
                            </div>
                          )}
                          <span className="absolute bottom-0 right-0 rounded bg-[#ff0000]/90 px-1 py-0.5 text-[9px] font-medium text-white">YT</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{r.title}</p>
                          <p className="text-[10px] text-slate-500">
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
                            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
                          >
                            {t.addToLibrary}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePlayYoutube(r)}
                            className="inline-flex h-8 items-center justify-center rounded-lg bg-[#1db954] px-2.5 text-xs font-semibold text-white transition hover:bg-[#1ed760]"
                          >
                            {t.playNow}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
