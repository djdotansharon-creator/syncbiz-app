"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { searchAll, type YouTubeSearchResult, type RadioSearchResult } from "@/lib/search-service";
import { createPlaylistFromUrl, resolveYouTubePlayableUrlForSearch } from "@/lib/search-playlist-client";
import { inferGenre } from "@/lib/infer-genre";
import { formatViewCount, formatDuration } from "@/lib/format-utils";
import { radioToUnified } from "@/lib/radio-utils";
import { savePlaylistToLocal, saveRadioToLocal } from "@/lib/unified-sources-client";
import { RadioIcon } from "@/components/ui/radio-icon";
import { useTranslations } from "@/lib/locale-context";
import type { UnifiedSource, RadioStream } from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";

type Props = {
  sources: UnifiedSource[];
  onAdd: (source: UnifiedSource) => void;
  onPlay: (source: UnifiedSource) => void;
  onSendToPlayer: (source: UnifiedSource) => void;
  /** Replace temp source with real after API create. Prevents duplicate entries. */
  onReplaceSource?: (tempId: string, real: UnifiedSource) => void;
  placeholder?: string;
  /** Controller mode: "Send to remote". Player mode: "Play here" */
  isControllerMode?: boolean;
  /** When set, edit links include return param for redirect after save (e.g. /mobile). */
  editReturnTo?: string;
};

export function MobileSearchBar({
  sources,
  onAdd,
  onPlay,
  onSendToPlayer,
  onReplaceSource,
  placeholder = "Search library or discover playlists…",
  isControllerMode = false,
  editReturnTo,
}: Props) {
  const { t } = useTranslations();
  const [query, setQuery] = useState("");
  const [internalResults, setInternalResults] = useState<UnifiedSource[]>([]);
  const [youtubeResults, setYoutubeResults] = useState<YouTubeSearchResult[]>([]);
  const [radioResults, setRadioResults] = useState<RadioSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const queryRef = useRef("");
  const panelRef = useRef<HTMLDivElement>(null);
  const playInFlightRef = useRef<Set<string>>(new Set());

  const hasQuery = query.trim().length >= 2;
  const hasInternal = internalResults.length > 0;
  const hasExternal = youtubeResults.length > 0 || radioResults.length > 0;
  const hasResults = hasInternal || hasExternal;

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setInternalResults([]);
      setYoutubeResults([]);
      setRadioResults([]);
      return;
    }
    queryRef.current = q;
    setSearching(true);
    try {
      const { internal, external } = await searchAll(sources, q);
      if (queryRef.current === q) {
        setInternalResults(internal);
        setYoutubeResults(external.youtube);
        setRadioResults(external.radio);
      }
    } catch {
      if (queryRef.current === q) {
        setInternalResults([]);
        setYoutubeResults([]);
        setRadioResults([]);
      }
    } finally {
      setSearching(false);
    }
  }, [query, sources]);

  useEffect(() => {
    if (!hasQuery) {
      setInternalResults([]);
      setYoutubeResults([]);
      setRadioResults([]);
      setShowResults(false);
      queryRef.current = "";
      return;
    }
    queryRef.current = query.trim();
    const id = setTimeout(runSearch, 300);
    return () => clearTimeout(id);
  }, [query, runSearch, hasQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent | PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, []);

  const handleAddYoutube = useCallback(
    async (r: YouTubeSearchResult) => {
      const genre = inferGenre(r.title, query);
      const playable =
        r.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(r.url) : r.url;
      const created = await createPlaylistFromUrl(playable, {
        title: r.title,
        genre,
        cover: r.cover,
        type: r.type,
        viewCount: r.viewCount,
        durationSeconds: r.durationSeconds,
      });
      if (created) {
        savePlaylistToLocal(created);
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
        setQuery("");
        setShowResults(false);
      }
    },
    [query, onAdd]
  );

  const handlePlayYoutube = useCallback(
    (r: YouTubeSearchResult) => {
      const key = `yt:${r.url}`;
      if (playInFlightRef.current.has(key)) return;
      playInFlightRef.current.add(key);

      void (async () => {
        try {
          const playable =
            r.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(r.url) : r.url;
          const genre = inferGenre(r.title, query);
          const tempId = `temp-yt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const minimalPlaylist: Playlist = {
            id: tempId,
            name: r.title,
            genre,
            type: r.type,
            url: playable,
            thumbnail: r.cover || "",
            createdAt: new Date().toISOString(),
          };
          const u: UnifiedSource = {
            id: `pl-${tempId}`,
            title: r.title,
            genre,
            cover: r.cover || null,
            type: "youtube",
            url: playable,
            origin: "playlist",
            playlist: minimalPlaylist,
          };
          onAdd(u);
          onPlay(u);
          setQuery("");
          setShowResults(false);

          const created = await createPlaylistFromUrl(playable, {
            title: r.title,
            genre,
            cover: r.cover,
            type: r.type,
            viewCount: r.viewCount,
            durationSeconds: r.durationSeconds,
          });
          if (created) {
            savePlaylistToLocal(created);
            const real: UnifiedSource = {
              id: `pl-${created.id}`,
              title: created.name,
              genre: created.genre || "Mixed",
              cover: created.thumbnail || null,
              type: "youtube",
              url: created.url,
              origin: "playlist",
              playlist: created,
            };
            if (onReplaceSource) {
              onReplaceSource(`pl-${tempId}`, real);
            } else {
              onAdd(real);
            }
          }
        } finally {
          playInFlightRef.current.delete(key);
        }
      })();
    },
    [query, onAdd, onPlay, onReplaceSource]
  );

  const handleSendYoutube = useCallback(
    async (r: YouTubeSearchResult) => {
      const genre = inferGenre(r.title, query);
      const playable =
        r.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(r.url) : r.url;
      const created = await createPlaylistFromUrl(playable, {
        title: r.title,
        genre,
        cover: r.cover,
        type: r.type,
        viewCount: r.viewCount,
        durationSeconds: r.durationSeconds,
      });
      if (created) {
        savePlaylistToLocal(created);
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
        onAdd(u);
        onSendToPlayer(u);
        setQuery("");
        setShowResults(false);
      }
    },
    [query, onAdd, onSendToPlayer]
  );

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
        const station = (await res.json()) as RadioStream;
        saveRadioToLocal(station);
        const unified = radioToUnified(station);
        onAdd(unified);
        setQuery("");
        setShowResults(false);
      }
    },
    [onAdd]
  );

  const handlePlayRadio = useCallback(
    (r: RadioSearchResult) => {
      const key = `radio:${r.url}`;
      if (playInFlightRef.current.has(key)) return;
      playInFlightRef.current.add(key);

      const tempId = `temp-radio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const minimalRadio: RadioStream = {
        id: tempId,
        name: r.title,
        url: r.url,
        genre: r.genre || "Radio",
        cover: r.cover,
        createdAt: new Date().toISOString(),
      };
      const unified = radioToUnified(minimalRadio);
      onAdd(unified);
      onPlay(unified);
      setQuery("");
      setShowResults(false);

      fetch("/api/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.title,
          url: r.url,
          genre: r.genre || "Radio",
          cover: r.cover,
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            const station = (await res.json()) as RadioStream;
            saveRadioToLocal(station);
            const real = radioToUnified(station);
            if (onReplaceSource) {
              onReplaceSource(unified.id, real);
            } else {
              onAdd(real);
            }
          }
        })
        .finally(() => {
          playInFlightRef.current.delete(key);
        });
    },
    [onAdd, onPlay, onReplaceSource]
  );

  const handleCopyUrl = useCallback((url: string) => {
    navigator.clipboard?.writeText(url);
  }, []);

  return (
    <div className="relative" ref={panelRef}>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowResults(true);
        }}
        onFocus={() => hasQuery && setShowResults(true)}
        placeholder={placeholder}
        aria-label="Search"
        className="w-full rounded-xl border border-slate-700/80 bg-slate-900/90 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        autoComplete="off"
      />

      {showResults && hasQuery && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-700/80 bg-slate-900/95 shadow-xl ring-1 ring-slate-700/60">
          {searching && !hasResults ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Searching…
            </div>
          ) : (
            <>
              {hasInternal && (
                <div className="border-b border-slate-700/60 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {t.localResults}
                  </p>
                  <div className="space-y-1">
                    {internalResults.map((source) => (
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
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{source.title}</p>
                          {source.genre && <p className="text-[10px] text-slate-500">{source.genre}</p>}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onPlay(source)}
                            className="rounded-lg bg-[#1db954] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1ed760]"
                          >
                            {t.play}
                          </button>
                          <button
                            type="button"
                            onClick={() => onSendToPlayer(source)}
                            className="rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                          >
                            {isControllerMode ? "Send" : "Play here"}
                          </button>
                          {source.origin === "playlist" && source.playlist && (
                            <Link
                              href={editReturnTo ? `/playlists/${source.playlist.id}/edit?return=${encodeURIComponent(editReturnTo)}` : `/playlists/${source.playlist.id}/edit`}
                              className="rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                            >
                              {t.edit}
                            </Link>
                          )}
                          {source.origin === "radio" && source.radio && (
                            <Link
                              href={editReturnTo ? `/radio/${source.radio.id}/edit?return=${encodeURIComponent(editReturnTo)}` : `/radio/${source.radio.id}/edit`}
                              className="rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                            >
                              {t.edit}
                            </Link>
                          )}
                          {source.origin === "source" && source.source && (
                            <Link
                              href={editReturnTo ? `/sources/${source.source.id}/edit?return=${encodeURIComponent(editReturnTo)}` : `/sources/${source.source.id}/edit`}
                              className="rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                            >
                              {t.edit}
                            </Link>
                          )}
                          <Link
                            href="/sources"
                            className="rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                          >
                            {t.open}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hasExternal && (
                <div className="p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
                    {t.youtubeResults}
                  </p>
                  {youtubeResults.length > 0 && (
                    <div className="space-y-1">
                      {youtubeResults.map((r, i) => (
                        <div
                          key={`yt-${i}`}
                          className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80"
                        >
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                            {r.cover ? (
                              <img src={r.cover} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[#ff0000]">
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
                              {r.viewCount != null && (
                                <span className="ml-1">• {formatViewCount(r.viewCount)} views</span>
                              )}
                              {r.durationSeconds != null && r.durationSeconds > 0 && (
                                <span className="ml-1">• {formatDuration(r.durationSeconds)}</span>
                              )}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => handleCopyUrl(r.url)}
                              className="rounded-lg border border-slate-600 bg-slate-800/90 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-700"
                            >
                              Copy URL
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAddYoutube(r)}
                              className="rounded-lg border border-slate-600 bg-slate-800/90 px-2 py-1 text-[10px] font-medium text-slate-200 hover:bg-slate-700"
                            >
                              {t.addToLibrary}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handlePlayYoutube(r)}
                              className="rounded-lg bg-[#1db954] px-2 py-1 text-[10px] font-medium text-white hover:bg-[#1ed760]"
                            >
                              {t.playNow}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSendYoutube(r)}
                              className="rounded-lg bg-amber-500/20 px-2 py-1 text-[10px] font-medium text-amber-200 hover:bg-amber-500/30"
                            >
                              {isControllerMode ? "Send to remote" : "Play here"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {radioResults.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t.radioResults ?? "Radio stations"}
                      </p>
                      {radioResults.map((r, i) => (
                        <div
                          key={`radio-${i}`}
                          className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80"
                        >
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
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => handleCopyUrl(r.url)}
                              className="rounded-lg border border-slate-600 bg-slate-800/90 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-700"
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAddRadio(r)}
                              className="rounded-lg border border-slate-600 bg-slate-800/90 px-2 py-1 text-[10px] font-medium text-slate-200 hover:bg-slate-700"
                            >
                              {t.addToRadio ?? "Add to Radio"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handlePlayRadio(r)}
                              className="rounded-lg bg-[#1db954] px-2 py-1 text-[10px] font-medium text-white hover:bg-[#1ed760]"
                            >
                              Play
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
