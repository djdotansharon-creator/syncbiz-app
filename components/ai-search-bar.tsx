"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { getYouTubeVideoId, inferPlaylistType } from "@/lib/playlist-utils";
import { createPlaylistFromUrl, resolveYouTubePlayableUrlForSearch } from "@/lib/search-playlist-client";
import { formatViewCount } from "@/lib/format-utils";
import { inferGenre } from "@/lib/infer-genre";
import { ActionButtonEdit } from "@/components/ui/action-buttons";
import { RadioIcon } from "@/components/ui/radio-icon";
import { runMusicDiscovery } from "@/lib/music-discovery";
import type { MusicDiscoveryCandidate } from "@/lib/music-discovery/types";
import { titleFromLocalPath } from "@/lib/local-audio-path";
import { createEphemeralLocalSearchSource } from "@/lib/play-next";
import { radioToUnified } from "@/lib/radio-utils";
import type {
  CatalogSearchResult,
  RadioSearchResult,
  YouTubeSearchResult,
} from "@/lib/search-service";
import type { RadioStream, UnifiedSource } from "@/lib/source-types";

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

function findDuplicateByUrl(sources: UnifiedSource[], url: string): UnifiedSource | null {
  const norm = normalizeUrlForCompare(url);
  return sources.find((s) => normalizeUrlForCompare(s.url) === norm) ?? null;
}

function localSnapshotHitDisplayTitle(hit: {
  artist: string | null;
  title: string | null;
  absolutePath: string;
}): string {
  const tr = (hit.title ?? "").trim();
  const ar = (hit.artist ?? "").trim();
  if (ar && tr) return `${ar} — ${tr}`;
  if (tr) return tr;
  if (ar) return ar;
  return titleFromLocalPath(hit.absolutePath);
}

async function fetchSources(): Promise<UnifiedSource[]> {
  const res = await fetch("/api/sources/unified", { cache: "no-store", credentials: "include" });
  if (!res.ok) return [];
  return res.json();
}

/** Map merged discovery hits back into UI buckets (order follows orchestrator ranking within each bucket). */
function partitionDiscoveryCandidates(
  candidates: MusicDiscoveryCandidate[],
  unifiedById: Map<string, UnifiedSource>
): {
  musicBankLocal: UnifiedSource[];
  local: UnifiedSource[];
  youtube: YouTubeSearchResult[];
  catalog: CatalogSearchResult[];
  radio: RadioSearchResult[];
} {
  const seenMusicBankLocal = new Set<string>();
  const musicBankLocal: UnifiedSource[] = [];
  const seenLocal = new Set<string>();
  const local: UnifiedSource[] = [];
  const youtube: YouTubeSearchResult[] = [];
  const catalog: CatalogSearchResult[] = [];
  const radio: RadioSearchResult[] = [];

  for (const c of candidates) {
    if (c.origin === "music_bank_local" && c.playbackUrl) {
      const key = ((c.trackId ?? "").trim() || c.dedupeKey).trim();
      if (key && !seenMusicBankLocal.has(key)) {
        seenMusicBankLocal.add(key);
        const genreParts = [c.signals?.tagGenre, c.subtitle]
          .map((x) => (x ?? "").trim())
          .filter(Boolean);
        musicBankLocal.push(
          createEphemeralLocalSearchSource(c.playbackUrl.trim(), {
            title: c.title,
            genre: genreParts.length ? genreParts.join(" · ") : null,
          }),
        );
      }
      continue;
    }
    if (c.unifiedSourceId) {
      const src = unifiedById.get(c.unifiedSourceId);
      if (src && !seenLocal.has(src.id)) {
        seenLocal.add(src.id);
        local.push(src);
      }
      continue;
    }
    if (c.origin === "external_web" && c.playbackUrl) {
      const ty = inferPlaylistType(c.playbackUrl);
      youtube.push({
        title: c.title,
        url: c.playbackUrl,
        cover: c.artworkUrl ?? null,
        type: ty === "soundcloud" ? "soundcloud" : "youtube",
        viewCount: c.signals?.viewCount ?? undefined,
      });
      continue;
    }
    if (c.origin === "syncbiz_catalog" && c.playbackUrl) {
      const genres = c.subtitle
        ? c.subtitle
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      catalog.push({
        id: (c.catalogItemId ?? "").trim() || c.dedupeKey.replace(/^catalog:/, "") || c.dedupeKey,
        url: c.playbackUrl,
        title: c.title,
        thumbnail: c.artworkUrl ?? null,
        genres,
      });
      continue;
    }
    if (c.origin === "radio" && c.playbackUrl) {
      radio.push({
        title: c.title,
        url: c.playbackUrl,
        cover: c.artworkUrl ?? null,
        genre: c.subtitle ?? "Radio",
      });
    }
  }
  return { musicBankLocal, local, youtube, catalog, radio };
}

const inputBase =
  "h-10 w-full rounded-xl border border-slate-700/80 bg-slate-800/80 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition-all focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/30 focus:outline-none";

export function AISearchBar() {
  const router = useRouter();
  const { t } = useTranslations();
  const { playSource } = usePlayback();

  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<UnifiedSource[]>([]);
  const [musicBankLocalResults, setMusicBankLocalResults] = useState<UnifiedSource[]>([]);
  const [localResults, setLocalResults] = useState<UnifiedSource[]>([]);
  const [youtubeResults, setYoutubeResults] = useState<YouTubeSearchResult[]>([]);
  const [catalogResults, setCatalogResults] = useState<CatalogSearchResult[]>([]);
  const [radioResults, setRadioResults] = useState<RadioSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const hasQuery = query.trim().length >= 2;
  const hasMusicBankLocal = musicBankLocalResults.length > 0;
  const hasLocal = localResults.length > 0;
  const hasYoutube = youtubeResults.length > 0;
  const hasCatalog = catalogResults.length > 0;
  const hasRadio = radioResults.length > 0;
  const hasResults = hasMusicBankLocal || hasLocal || hasYoutube || hasCatalog || hasRadio;
  const hasSectionAfterCatalog = hasMusicBankLocal || hasLocal || hasYoutube || hasRadio;
  const hasSectionAfterMusicBank = hasLocal || hasYoutube || hasRadio;

  const searchMusicBankLocal = useCallback(async (query: string, limit: number): Promise<MusicDiscoveryCandidate[]> => {
    if (typeof window === "undefined") return [];
    const inv = window.syncbizDesktop?.searchLocalCollectionSnapshot;
    if (typeof inv !== "function") return [];
    const res = await inv(query, limit);
    if (res.status !== "ok") return [];
    return res.hits.map((hit) => ({
      origin: "music_bank_local" as const,
      dedupeKey: `musicbank:${hit.localId}`,
      title: localSnapshotHitDisplayTitle(hit),
      subtitle:
        [hit.album, hit.year]
          .map((x) => (x ?? "").trim())
          .filter(Boolean)
          .join(" · ") || undefined,
      playbackUrl: hit.absolutePath,
      trackId: hit.localId,
      score: 700 + Math.min(hit.score, 250),
      signals: { tagGenre: hit.genre },
    }));
  }, []);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setMusicBankLocalResults([]);
      setLocalResults([]);
      setYoutubeResults([]);
      setCatalogResults([]);
      setRadioResults([]);
      setError(null);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const unified = await fetchSources();
      setSources(unified);
      const { candidates } = await runMusicDiscovery({
        query: { rawText: q },
        unifiedSources: unified,
        deps: { searchMusicBankLocal },
      });
      const byId = new Map(unified.map((s) => [s.id, s]));
      const { musicBankLocal, local, youtube, catalog, radio } = partitionDiscoveryCandidates(candidates, byId);
      setMusicBankLocalResults(musicBankLocal);
      setLocalResults(local);
      setYoutubeResults(youtube);
      setCatalogResults(catalog);
      setRadioResults(radio);
      if (
        musicBankLocal.length === 0 &&
        local.length === 0 &&
        youtube.length === 0 &&
        catalog.length === 0 &&
        radio.length === 0
      ) {
        setError(t.noSearchResults ?? "No results in library or YouTube.");
      }
    } catch {
      setError(t.error ?? "Search failed. Try again.");
    } finally {
      setSearching(false);
    }
  }, [query, t.noSearchResults, t.error, searchMusicBankLocal]);

  useEffect(() => {
    if (!hasQuery) {
      setMusicBankLocalResults([]);
      setLocalResults([]);
      setYoutubeResults([]);
      setCatalogResults([]);
      setRadioResults([]);
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

  const handleAddRadio = useCallback(
    async (r: RadioSearchResult) => {
      const res = await fetch("/api/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.title,
          url: r.url,
          genre: r.genre || "Radio",
          cover: r.cover,
        }),
      });
      if (res.ok) {
        router.push("/sources");
        router.refresh();
        setQuery("");
        setYoutubeResults([]);
        setRadioResults([]);
        setCatalogResults([]);
        setMusicBankLocalResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [router]
  );

  const handlePlayRadio = useCallback(
    async (r: RadioSearchResult) => {
      const res = await fetch("/api/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.title,
          url: r.url,
          genre: r.genre || "Radio",
          cover: r.cover,
        }),
      });
      if (res.ok) {
        const station = (await res.json()) as RadioStream;
        const unified = radioToUnified(station);
        playSource(unified);
        router.refresh();
        setQuery("");
        setYoutubeResults([]);
        setRadioResults([]);
        setCatalogResults([]);
        setMusicBankLocalResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [playSource, router]
  );

  const handleAddCatalog = useCallback(
    async (r: CatalogSearchResult) => {
      const genre = inferGenre(r.title, query);
      const playable = await resolveYouTubePlayableUrlForSearch(r.url);
      const created = await createPlaylistFromUrl(playable, {
        title: r.title,
        genre,
        cover: r.thumbnail,
        type: "youtube",
      });
      if (created) {
        router.push("/sources");
        router.refresh();
        setQuery("");
        setCatalogResults([]);
        setYoutubeResults([]);
        setRadioResults([]);
        setMusicBankLocalResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [query, router]
  );

  const handlePlayCatalog = useCallback(
    async (r: CatalogSearchResult) => {
      const genre = inferGenre(r.title, query);
      const playable = await resolveYouTubePlayableUrlForSearch(r.url);
      const created = await createPlaylistFromUrl(playable, {
        title: r.title,
        genre,
        cover: r.thumbnail,
        type: "youtube",
      });
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
        playSource(u);
        router.push("/sources");
        router.refresh();
        setQuery("");
        setCatalogResults([]);
        setYoutubeResults([]);
        setRadioResults([]);
        setMusicBankLocalResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [playSource, query, router]
  );

  const handleAddYoutube = useCallback(
    async (r: YouTubeSearchResult) => {
      const playable =
        r.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(r.url) : r.url;
      const existing = findDuplicateByUrl(sources, playable);
      if (existing) {
        router.push("/sources");
        router.refresh();
        setQuery("");
        setCatalogResults([]);
        setRadioResults([]);
        setMusicBankLocalResults([]);
        setLocalResults([]);
        setShowResults(false);
        return;
      }
      const genre = inferGenre(r.title, query);
      const created = await createPlaylistFromUrl(playable, {
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
        setCatalogResults([]);
        setRadioResults([]);
        setMusicBankLocalResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [sources, query, router]
  );

  const handlePlayYoutube = useCallback(
    async (r: YouTubeSearchResult) => {
      const playable =
        r.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(r.url) : r.url;
      const existing = findDuplicateByUrl(sources, playable);
      if (existing) {
        playSource(existing);
        setQuery("");
        setCatalogResults([]);
        setRadioResults([]);
        setMusicBankLocalResults([]);
        setShowResults(false);
        return;
      }
      const genre = inferGenre(r.title, query);
      const created = await createPlaylistFromUrl(playable, {
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
        setCatalogResults([]);
        setRadioResults([]);
        setMusicBankLocalResults([]);
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
              setMusicBankLocalResults([]);
              setLocalResults([]);
              setYoutubeResults([]);
              setCatalogResults([]);
              setRadioResults([]);
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
              {hasCatalog && (
                <div className={`p-2 ${hasSectionAfterCatalog ? "border-b border-slate-800/60" : ""}`}>
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-violet-400">From Catalog</p>
                  <div className="space-y-0.5">
                    {catalogResults.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                          {r.thumbnail ? (
                            <img src={r.thumbnail} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-violet-400">
                              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M9 18V5l12-2v13" />
                                <circle cx="6" cy="18" r="3" />
                                <circle cx="18" cy="16" r="3" />
                              </svg>
                            </div>
                          )}
                          <span className="absolute bottom-0 right-0 rounded bg-violet-600/90 px-1 py-0.5 text-[9px] font-medium text-white">CAT</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{r.title}</p>
                          <p className="text-[10px] text-violet-400/80">
                            Global Catalog
                            {r.genres && r.genres.length > 0 && (
                              <span className="ml-1.5 text-slate-400">• {r.genres[0]}</span>
                            )}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleAddCatalog(r)}
                            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
                          >
                            {t.addToLibrary}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePlayCatalog(r)}
                            className="inline-flex h-8 items-center justify-center rounded-lg bg-violet-600 px-2.5 text-xs font-semibold text-white transition hover:bg-violet-500"
                          >
                            {t.playNow}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasMusicBankLocal && (
                <div className={`p-2 ${hasSectionAfterMusicBank ? "border-b border-slate-800/60" : ""}`}>
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
                    My Music Library
                  </p>
                  <div className="space-y-0.5">
                    {musicBankLocalResults.map((source) => (
                      <div
                        key={source.id}
                        className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80"
                      >
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                          <div className="flex h-full w-full items-center justify-center text-emerald-500/90">
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M9 18V5l12-2v13" />
                              <circle cx="6" cy="18" r="3" />
                              <circle cx="18" cy="16" r="3" />
                            </svg>
                          </div>
                          <span className="absolute bottom-0 right-0 rounded bg-emerald-700/95 px-1 py-0.5 text-[9px] font-medium text-white">
                            DISK
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{source.title}</p>
                          {source.genre && <p className="text-[10px] text-slate-500">{source.genre}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              playSource(source);
                              setQuery("");
                              setMusicBankLocalResults([]);
                              setLocalResults([]);
                              setYoutubeResults([]);
                              setCatalogResults([]);
                              setRadioResults([]);
                              setShowResults(false);
                            }}
                            className="inline-flex h-8 items-center justify-center rounded-lg bg-[#1db954] px-2.5 text-xs font-medium text-white transition hover:bg-[#1ed760]"
                          >
                            {t.play ?? t.playNow}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasLocal && (
                <div className={`p-2 ${hasYoutube || hasRadio ? "border-b border-slate-800/60" : ""}`}>
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
                <div className={`p-2 ${hasRadio ? "border-b border-slate-800/60" : ""}`}>
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.youtubeResults}</p>
                  <div className="space-y-0.5">
                    {youtubeResults.map((r, i) => (
                      <div key={`${r.url}-${i}`} className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80">
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
                          <span
                            className={`absolute bottom-0 right-0 rounded px-1 py-0.5 text-[9px] font-medium text-white ${
                              r.type === "soundcloud" ? "bg-[#ff5500]/90" : "bg-[#ff0000]/90"
                            }`}
                          >
                            {r.type === "soundcloud" ? "SC" : "YT"}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{r.title}</p>
                          <p className="text-[10px] text-slate-500">
                            {r.type === "soundcloud" ? "SoundCloud" : "YouTube"}
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
              {hasRadio && (
                <div className="p-2">
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.radioResults ?? "Radio stations"}</p>
                  <div className="space-y-0.5">
                    {radioResults.map((r, i) => (
                      <div key={`${r.url}-${i}`} className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                          {r.cover ? (
                            <img src={r.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-rose-400">
                              <RadioIcon className="h-5 w-5" />
                            </div>
                          )}
                          <span className="absolute bottom-0 right-0 rounded bg-rose-500/90 px-1 py-0.5 text-[9px] font-medium text-white">LIVE</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{r.title}</p>
                          <p className="text-[10px] text-slate-500">{r.genre || "Radio"}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleAddRadio(r)}
                            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
                          >
                            {t.addToRadio ?? "Add to Radio"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePlayRadio(r)}
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
