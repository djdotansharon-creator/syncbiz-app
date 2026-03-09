"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { useSourcesPlayback } from "@/lib/sources-playback-context";
import { ActionButtonEdit } from "@/components/ui/action-buttons";
import { inferPlaylistType, getYouTubeThumbnail } from "@/lib/playlist-utils";
import { getPlaylistTracks } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";
import type { RadioStream } from "@/lib/source-types";

type YouTubeResult = { title: string; url: string; cover: string | null; type: "youtube" | "soundcloud" };

const controlHeight = "h-10";
const inputBase =
  "w-full rounded-xl border border-slate-700/80 bg-slate-800/60 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-all focus:border-[#1ed760]/60 focus:ring-2 focus:ring-[#1ed760]/25 focus:outline-none disabled:opacity-60 backdrop-blur-sm";
const addBtn =
  "shrink-0 rounded-full bg-gradient-to-b from-[#1ed760] to-[#1db954] px-5 text-sm font-semibold text-white shadow-[0_0_0_2px_rgba(29,185,84,0.35),0_2px_8px_rgba(29,185,84,0.2)] transition-all hover:from-[#2ee770] hover:to-[#1ed760] hover:shadow-[0_0_0_2px_rgba(30,215,96,0.5),0_4px_16px_rgba(30,215,96,0.3)] disabled:opacity-40 disabled:pointer-events-none";

/** Infer genre from title or query keywords. */
function inferGenre(title: string, query: string): string {
  const text = `${title} ${query}`.toLowerCase();
  const keywords: Record<string, string> = {
    chill: "Chill",
    lofi: "Lofi",
    techno: "Techno",
    house: "House",
    jazz: "Jazz",
    mix: "Mixed",
    "top hits": "Pop",
    "most played": "Mixed",
    playlist: "Mixed",
  };
  for (const [kw, genre] of Object.entries(keywords)) {
    if (text.includes(kw)) return genre;
  }
  return "Mixed";
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
    const sourceName = s.source?.name ? s.source.name.toLowerCase() : "";
    let searchable = `${title} ${genre} ${type} ${radioName} ${sourceName}`;
    if (s.playlist) {
      const tracks = getPlaylistTracks(s.playlist);
      const trackNames = tracks.map((t) => (t.name || (t as { title?: string }).title || "").toLowerCase()).join(" ");
      searchable += ` ${trackNames}`;
    }
    return words.some((w) => searchable.includes(w));
  });
}

async function searchYouTube(q: string): Promise<YouTubeResult[]> {
  if (!q.trim() || q.length < 2) return [];
  const res = await fetch(`/api/sources/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return data.results || [];
}

async function parseUrl(url: string): Promise<{ title: string; cover: string | null; genre: string; type: string; isRadio: boolean } | null> {
  const res = await fetch("/api/sources/parse-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) return null;
  return res.json();
}

async function createPlaylistFromUrl(
  url: string,
  meta?: { title: string; genre: string; cover: string | null; type: string }
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
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

function SourceLogo({ type, origin, size = "sm" }: { type: UnifiedSource["type"]; origin?: UnifiedSource["origin"]; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const color =
    type === "youtube" ? "text-[#ff0000]" : type === "soundcloud" ? "text-[#ff5500]" : type === "spotify" ? "text-[#1db954]" : "text-slate-300";
  return (
    <span className={`flex ${sizeClass} items-center justify-center rounded bg-black/60 p-0.5 ${color}`}>
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
  onAdd: (source: UnifiedSource) => void;
};

export function LibraryInputArea({ onAdd }: Props) {
  const router = useRouter();
  const { t } = useTranslations();
  const { sources } = useSourcesPlayback();
  const { playSource } = usePlayback();

  const [urlValue, setUrlValue] = useState("");
  const [urlIngesting, setUrlIngesting] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<UnifiedSource[]>([]);
  const [youtubeResults, setYoutubeResults] = useState<YouTubeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchQueryRef = useRef("");

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
    searchQueryRef.current = q;
    setSearching(true);
    setYoutubeResults([]);
    const local = searchLocal(sources, q);
    setLocalResults(local);
    if (local.length > 0) {
      setSearching(false);
      return;
    }
    try {
      const yt = await searchYouTube(q);
      if (searchQueryRef.current === q) setYoutubeResults(yt);
    } catch {
      if (searchQueryRef.current === q) setYoutubeResults([]);
    } finally {
      setSearching(false);
    }
  }, [query, sources]);

  useEffect(() => {
    if (!hasQuery) {
      setLocalResults([]);
      setYoutubeResults([]);
      setShowResults(false);
      searchQueryRef.current = "";
      return;
    }
    searchQueryRef.current = query.trim();
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

  const ingestUrl = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      setUrlIngesting(true);
      setUrlError(null);
      try {
        const parsed = await parseUrl(trimmed);
        if (!parsed) {
          setUrlError("Could not parse URL");
          return;
        }
        const type = inferPlaylistType(trimmed);
        const isRadio = parsed.isRadio || type === "winamp" || trimmed.match(/\.(m3u8?|pls|aac|mp3)(\?|$)/i);
        if (isRadio) {
          const res = await fetch("/api/radio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: parsed.title, url: trimmed, genre: parsed.genre, cover: parsed.cover || null }),
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
            setUrlValue("");
            router.refresh();
          } else setUrlError("Failed to add");
        } else {
          const res = await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: parsed.title,
              url: trimmed,
              genre: parsed.genre,
              type: parsed.type,
              thumbnail: parsed.cover || "",
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
            setUrlValue("");
            router.refresh();
          } else setUrlError("Failed to add");
        }
      } catch {
        setUrlError("Failed to add");
      } finally {
        setUrlIngesting(false);
      }
    },
    [onAdd, router]
  );

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void ingestUrl(urlValue);
  };

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
    (!!(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const handleAddAllYoutube = useCallback(
    async () => {
      for (const r of youtubeResults) {
        const genre = inferGenre(r.title, query);
        const created = await createPlaylistFromUrl(r.url, { title: r.title, genre, cover: r.cover, type: r.type });
        if (created) {
          const unified: UnifiedSource = {
            id: `pl-${created.id}`,
            title: created.name,
            genre: created.genre || "Mixed",
            cover: created.thumbnail || null,
            type: created.type as UnifiedSource["type"],
            url: created.url,
            origin: "playlist",
            playlist: created,
          };
          onAdd(unified);
        }
      }
      router.refresh();
      setQuery("");
      setYoutubeResults([]);
      setLocalResults([]);
      setShowResults(false);
    },
    [query, youtubeResults, onAdd, router]
  );

  const handleAddYoutube = useCallback(
    async (r: YouTubeResult) => {
      const genre = inferGenre(r.title, query);
      const created = await createPlaylistFromUrl(r.url, { title: r.title, genre, cover: r.cover, type: r.type });
      if (created) {
        const unified: UnifiedSource = {
          id: `pl-${created.id}`,
          title: created.name,
          genre: created.genre || "Mixed",
          cover: created.thumbnail || null,
          type: created.type as UnifiedSource["type"],
          url: created.url,
          origin: "playlist",
          playlist: created,
        };
        onAdd(unified);
        router.refresh();
        setQuery("");
        setYoutubeResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [query, onAdd, router]
  );

  const handlePlayYoutube = useCallback(
    async (r: YouTubeResult) => {
      const genre = inferGenre(r.title, query);
      const created = await createPlaylistFromUrl(r.url, { title: r.title, genre, cover: r.cover, type: r.type });
      if (created) {
        const u: UnifiedSource = {
          id: `pl-${created.id}`,
          title: created.name,
          genre: "Mixed",
          cover: created.thumbnail || null,
          type: "youtube",
          url: created.url,
          origin: "playlist",
          playlist: created,
        };
        onAdd(u);
        playSource(u);
        router.refresh();
        setQuery("");
        setYoutubeResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [query, playSource, router, onAdd]
  );

  return (
    <div
      ref={panelRef}
      onDrop={(e) => {
        const text = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text/uri-list");
        if (text?.trim() && text.startsWith("http")) {
          e.preventDefault();
          void ingestUrl(text.trim());
        }
      }}
      onDragOver={(e) => {
        const text = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text/uri-list");
        if (text?.trim() && text.startsWith("http")) {
          e.preventDefault();
        }
      }}
      className="relative"
    >
      {/* Single compact control row */}
      <div className="flex flex-nowrap items-center gap-2">
        {/* Add URL Source */}
        <form onSubmit={handleUrlSubmit} className="flex min-w-0 flex-1 items-center gap-2">
          <div className={`relative min-w-0 flex-1 ${controlHeight}`}>
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </span>
            <input
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder={t.addUrlPlaceholder ?? "Add URL source…"}
              disabled={urlIngesting}
              className={`${inputBase} ${controlHeight} pl-9 pr-3`}
            />
          </div>
          <button type="submit" disabled={urlIngesting || !urlValue.trim()} className={`${addBtn} ${controlHeight}`}>
            {urlIngesting ? (t.adding ?? "Adding…") : t.add ?? "Add"}
          </button>
        </form>

        {/* Search Library / YouTube + Mic */}
        <div
          className={`relative flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-slate-700/80 bg-slate-800/60 backdrop-blur-sm transition-all focus-within:border-[#1ed760]/60 focus-within:ring-2 focus-within:ring-[#1ed760]/25 ${
            showResults && hasResults ? "rounded-b-none border-b-0" : ""
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
                if (e.shiftKey) {
                  if (hasYoutube && youtubeResults.length > 0) {
                    void handleAddAllYoutube();
                  }
                  return;
                }
                if (hasLocal && localResults.length > 0) {
                  playSource(localResults[0]);
                  setShowResults(false);
                  return;
                }
                if (hasYoutube && youtubeResults.length > 0) {
                  void handlePlayYoutube(youtubeResults[0]);
                  return;
                }
                void runSearch();
                setShowResults(true);
              }
            }}
            placeholder={t.universalSearchPlaceholder ?? "Search library or find on YouTube…"}
            className={`${controlHeight} flex-1 bg-transparent py-2 pr-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none`}
            aria-label={t.search}
            autoComplete="off"
          />
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
              aria-label="Clear"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {voiceSupported && (
            <button
              type="button"
              onClick={handleVoiceSearch}
              disabled={listening}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all ${
                listening
                  ? "border-[#1ed760]/60 text-[#1ed760] shadow-[0_0_12px_rgba(30,215,96,0.35)]"
                  : "border-slate-600/80 text-slate-400 hover:border-[#1ed760]/50 hover:text-[#1ed760] hover:shadow-[0_0_12px_rgba(30,215,96,0.2)]"
              }`}
              title={t.voiceSearch}
              aria-label={t.voiceSearch}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0V8a5 5 0 0110 0v3z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {urlError && <p className="mt-1.5 text-xs text-amber-400">{urlError}</p>}

      {/* Search results dropdown */}
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
          ) : (
            <>
              {hasLocal && (
                <div className="border-b border-slate-800/60 p-2">
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.localResults}</p>
                  <div className="space-y-0.5">
                    {localResults.map((source) => (
                      <div key={source.id} className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80">
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
                          <div className="absolute bottom-0 right-0 p-0.5">
                            <SourceLogo type={source.type} origin={source.origin} size="sm" />
                          </div>
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
                            <ActionButtonEdit href={`/playlists/${source.playlist.id}/edit`} size="xs" title={t.edit} aria-label={t.edit} />
                          )}
                          {source.origin === "radio" && source.radio && (
                            <ActionButtonEdit href={`/radio/${source.radio.id}/edit`} size="xs" title={t.edit} aria-label={t.edit} />
                          )}
                          {source.origin === "source" && source.source && (
                            <ActionButtonEdit href={`/sources/${source.source.id}/edit`} size="xs" title={t.edit} aria-label={t.edit} />
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
                          <p className="text-[10px] text-slate-500">YouTube</p>
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
              {!searching && hasQuery && !hasResults && (
                <div className="py-6 text-center text-sm text-slate-500">{t.noSearchResults}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
