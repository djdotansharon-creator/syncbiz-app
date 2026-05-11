"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "@/lib/locale-context";
import { getTranslations } from "@/lib/translations";
import { usePlayback } from "@/lib/playback-provider";
import { useSourcesPlayback } from "@/lib/sources-playback-context";
import { ActionButtonEdit } from "@/components/ui/action-buttons";
import { RadioIcon } from "@/components/ui/radio-icon";
import { YouTubeMixImportPanelShell } from "@/components/youtube-mix-import-panel-shell";
import {
  inferPlaylistType,
  getYouTubeThumbnail,
  getYouTubeVideoId,
  isYouTubeMixUrl,
  isYouTubeMultiTrackUrl,
  classifyMusicUrlIngest,
  canonicalYouTubeWatchUrlForPlayback,
  isShazamUrl,
  isWeakStorefrontParsedTitle,
} from "@/lib/playlist-utils";
import { createPlaylistFromUrl, resolveYouTubePlayableUrlForSearch } from "@/lib/search-playlist-client";
import { formatViewCount, formatDuration } from "@/lib/format-utils";
import { inferGenre } from "@/lib/infer-genre";
import { searchAll, searchExternal, type YouTubeSearchResult, type RadioSearchResult } from "@/lib/search-service";
import { createEphemeralLocalSearchSource } from "@/lib/play-next";
import { radioToUnified } from "@/lib/radio-utils";
import {
  pickUnifiedFoundationFields,
  parseUrlFoundationHints,
  unifiedFoundationHints,
  type UnifiedSource,
  type ParseUrlJson,
  type RadioStream,
} from "@/lib/source-types";
import type { Playlist } from "@/lib/playlist-types";
import {
  collectElectronFilePathsFromDataTransfer,
  isLocalPathLikelyFolderInWebBrowser,
  isPlaylistContainerPath,
  normalizeLocalFilePathInput,
  resolveDesktopFolderDropPath,
  titleFromLocalPath,
} from "@/lib/local-audio-path";
import { createUnifiedPlaylistFromLocalScan } from "@/lib/local-music-library-playlist";
import { M3uYoutubeResolveModal } from "@/components/m3u-youtube-resolve-modal";
import {
  buildM3uYoutubeResolveContext,
  unresolvedM3uSummaryHint,
  type M3uYoutubeResolveContextState,
} from "@/lib/m3u-youtube-resolve-shared";
import "@/components/library-input-ingest-effects.css";
import { CompactSourceBadge, TrackMediaPlaceholder } from "@/components/track-source-visual";
import { inferTrackSourceChip } from "@/lib/track-source-chip";
import {
  tryBuildExternalMusicYoutubeSearchQuery,
  isMusicUrlYoutubePickerProvider,
  narrowExternalMusicYoutubeDisplay,
  pseudoM3uRowForExternalMusicPaste,
} from "@/lib/external-music-youtube-resolve";
import {
  ExternalMusicYoutubePickerPanel,
  type ExternalMusicYtResolvePack,
} from "@/components/external-music-youtube-picker";

/** Animated shell phase for M3U / URL ingest (`sb-library-ingest-shell--*` in CSS). */
function libraryUrlIngestPhaseClass(phase: string | null): string {
  const p = (phase ?? "").toLowerCase();
  if (p.includes("reading playlist")) return "sb-library-ingest-shell--read";
  if (p.includes("resolving")) return "sb-library-ingest-shell--resolve";
  if (p.includes("youtube")) return "sb-library-ingest-shell--youtube";
  if (p.includes("creating")) return "sb-library-ingest-shell--save";
  return "sb-library-ingest-shell--neutral";
}

const controlHeight = "h-10";
const inputBase =
  "w-full rounded-xl border border-slate-800/80 bg-slate-800/80 ring-1 ring-slate-700/60 py-2 text-sm text-slate-100 placeholder:text-slate-400 transition-all focus:border-[#1ed760]/70 focus:ring-2 focus:ring-[#1ed760]/30 focus:outline-none disabled:opacity-60 backdrop-blur-sm";
const addBtn =
  "shrink-0 rounded-full bg-gradient-to-b from-[#1ed760] to-[#1db954] px-5 text-sm font-semibold text-white shadow-[0_0_0_2px_rgba(29,185,84,0.35),0_2px_8px_rgba(29,185,84,0.2)] transition-all hover:from-[#2ee770] hover:to-[#1ed760] hover:shadow-[0_0_0_2px_rgba(30,215,96,0.5),0_4px_16px_rgba(30,215,96,0.3)] disabled:opacity-40 disabled:pointer-events-none";

/** Desktop: trace folder drag; remove or gate if noisy. */
function logDesktopLibraryIngestDrop(e: React.DragEvent, payload: string | null) {
  if (typeof window === "undefined" || !window.syncbizDesktop) return;
  const dt = e.dataTransfer;
  const collected = collectElectronFilePathsFromDataTransfer(dt);
  const fileRows = Array.from({ length: dt.files.length }, (_, i) => {
    const f = dt.files[i] as File & { path?: string };
    let getPath = "";
    try {
      getPath = window.syncbizDesktop?.getPathForFile?.(f) ?? "";
    } catch {
      /* */
    }
    return { name: f.name, pathProp: f.path ?? "", getPathForFile: getPath };
  });
  console.debug("[SyncBiz:library-dnd]", {
    filesLen: dt.files.length,
    itemsLen: dt.items.length,
    types: [...dt.types],
    fileRows,
    collected,
    hasScan: typeof window.syncbizDesktop?.scanLocalAudioFolder === "function",
    hasGetPath: typeof window.syncbizDesktop?.getPathForFile === "function",
    resolvedIngestPath: payload,
  });
}

/** Compose a display title for a local snapshot hit (artist — title, falling back to filename). */
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

/**
 * Desktop-only: search the persisted local collection snapshot via the preload bridge
 * and convert hits into ephemeral UnifiedSources (no playlist creation, no folder scan,
 * no tag read). Returns [] in browser/SSR or when the bridge is missing.
 */
async function searchMusicBankLocalSnapshot(query: string, limit: number): Promise<UnifiedSource[]> {
  if (typeof window === "undefined") return [];
  const inv = window.syncbizDesktop?.searchLocalCollectionSnapshot;
  if (typeof inv !== "function") return [];
  try {
    const res = await inv(query, limit);
    if (res.status !== "ok") return [];
    const seen = new Set<string>();
    const out: UnifiedSource[] = [];
    for (const hit of res.hits) {
      const abs = (hit.absolutePath ?? "").trim();
      if (!abs) continue;
      const key = (hit.localId ?? "").trim() || abs;
      if (seen.has(key)) continue;
      seen.add(key);
      const genre = (hit.genre ?? "").trim() || null;
      out.push(
        createEphemeralLocalSearchSource(abs, {
          title: localSnapshotHitDisplayTitle(hit),
          genre,
        }),
      );
    }
    return out;
  } catch {
    return [];
  }
}

async function parseUrl(url: string): Promise<ParseUrlJson | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch("/api/sources/parse-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Storefront / OG + noembed parsing can exceed the default fast parse cap. */
async function parseUrlStorefront(url: string): Promise<ParseUrlJson | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 14_000);
  try {
    const res = await fetch("/api/sources/parse-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
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
        <span className={`${sizeClass} text-rose-400`}>
          <RadioIcon className={sizeClass} />
        </span>
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
  /** When in CONTROL mode, use this to send PLAY_SOURCE to MASTER instead of local play. */
  playSourceOverride?: (source: UnifiedSource) => void;
  /** After M3U YouTube merges, refresh the playlist tile in Sources (same as My Music). */
  onPlaylistUpdated?: (source: UnifiedSource) => void;
};

export function LibraryInputArea({ onAdd, playSourceOverride, onPlaylistUpdated }: Props) {
  const router = useRouter();
  const { t } = useTranslations();
  const { locale } = useLocale();
  const tx = useMemo(() => getTranslations(locale), [locale]);
  const { sources } = useSourcesPlayback();
  const { playSource } = usePlayback();
  const effectivePlaySource = playSourceOverride ?? playSource;

  const [urlValue, setUrlValue] = useState("");
  const [urlIngesting, setUrlIngesting] = useState(false);
  const [urlIngestPhase, setUrlIngestPhase] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [youtubeMixImportUrl, setYoutubeMixImportUrl] = useState<string | null>(null);
  const [externalMusicResolveHint, setExternalMusicResolveHint] = useState<string | null>(null);
  const [externalYtResolvePack, setExternalYtResolvePack] = useState<ExternalMusicYtResolvePack | null>(null);
  const [externalYtSaveBusy, setExternalYtSaveBusy] = useState(false);
  const [m3uImportBanner, setM3uImportBanner] = useState<{
    imported: number;
    unresolved: number;
    skipped: number;
    unresolvedHint?: string;
    playlistName?: string;
    error?: string;
  } | null>(null);
  const [m3uYoutubeResolveContext, setM3uYoutubeResolveContext] = useState<M3uYoutubeResolveContextState | null>(null);
  const [youtubeResolveOpen, setYoutubeResolveOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [musicBankLocalResults, setMusicBankLocalResults] = useState<UnifiedSource[]>([]);
  const [localResults, setLocalResults] = useState<UnifiedSource[]>([]);
  const [youtubeResults, setYoutubeResults] = useState<YouTubeSearchResult[]>([]);
  const [radioResults, setRadioResults] = useState<RadioSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchQueryRef = useRef("");

  const hasQuery = query.trim().length >= 2;
  const hasMusicBankLocal = musicBankLocalResults.length > 0;
  const hasLocal = localResults.length > 0;
  const hasYoutube = youtubeResults.length > 0;
  const hasRadio = radioResults.length > 0;
  const hasResults = hasMusicBankLocal || hasLocal || hasYoutube || hasRadio;

  const ingestStripBusy = urlIngesting || searching || externalYtSaveBusy;
  const ingestShellPhaseClass = ingestStripBusy
    ? urlIngesting
      ? libraryUrlIngestPhaseClass(urlIngestPhase)
      : "sb-library-ingest-shell--read"
    : "";

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setMusicBankLocalResults([]);
      setLocalResults([]);
      setYoutubeResults([]);
      setRadioResults([]);
      return;
    }
    searchQueryRef.current = q;
    setSearching(true);
    setYoutubeResults([]);
    setRadioResults([]);
    try {
      const [allRes, mblRes] = await Promise.all([
        searchAll(sources, q),
        searchMusicBankLocalSnapshot(q, 25),
      ]);
      if (searchQueryRef.current === q) {
        setLocalResults(allRes.internal);
        setYoutubeResults(allRes.external.youtube);
        setRadioResults(allRes.external.radio);
        setMusicBankLocalResults(mblRes);
      }
    } catch {
      if (searchQueryRef.current === q) {
        setMusicBankLocalResults([]);
        setLocalResults([]);
        setYoutubeResults([]);
        setRadioResults([]);
      }
    } finally {
      setSearching(false);
    }
  }, [query, sources]);

  useEffect(() => {
    if (!hasQuery) {
      setMusicBankLocalResults([]);
      setLocalResults([]);
      setYoutubeResults([]);
      setRadioResults([]);
      setShowResults(false);
      searchQueryRef.current = "";
      return;
    }
    searchQueryRef.current = query.trim();
    const id = setTimeout(runSearch, 200);
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

  const ingestingRef = useRef(false);
  const ingestUrl = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      const localPath = normalizeLocalFilePathInput(trimmed);
      if (localPath) {
        if (ingestingRef.current) return;
        ingestingRef.current = true;
        setUrlIngesting(true);
        setUrlError(null);
        setYoutubeMixImportUrl(null);
        setExternalMusicResolveHint(null);
        setExternalYtResolvePack(null);
        try {
          const desktop = typeof window !== "undefined" ? window.syncbizDesktop : undefined;

          // M3U / M3U8 / PLS are playlist containers, not audio tracks. Route to the
          // desktop importer so the *resolved* local audio files (under the configured
          // music folder) become the playlist's tracks. Saving the .m3u path itself as a
          // single "url" track is the bug — it produced a 1-track playlist regardless of
          // how many entries the file referenced.
          if (isPlaylistContainerPath(localPath)) {
            const importer = desktop?.importLocalM3uPlaylist;
            if (typeof importer !== "function") {
              setUrlError(tx.urlErrorLocalFolderDesktopOnly);
              return;
            }
            setM3uImportBanner(null);
            setM3uYoutubeResolveContext(null);
            setYoutubeResolveOpen(false);
            setUrlIngestPhase("Reading playlist…");
            let phaseTimer: number | undefined;
            try {
              phaseTimer = window.setTimeout(() => {
                setUrlIngestPhase("Resolving local files…");
              }, 380);
              const res = await importer(localPath);
              if (phaseTimer !== undefined) {
                window.clearTimeout(phaseTimer);
                phaseTimer = undefined;
              }

              if (res.status === "error") {
                setUrlError(res.message || tx.urlErrorFailedAdd);
                return;
              }

              const hasTracks = res.files.length > 0;
              const hasUnresolved = res.unresolved.length > 0;

              if (!hasTracks && !hasUnresolved && res.skipped === 0) {
                setUrlError("No playable local tracks under your music folder were listed in this file.");
                return;
              }
              if (!hasTracks && !hasUnresolved && res.skipped > 0) {
                setUrlError(
                  "All listed tracks were skipped (outside music folder, missing, or not audio). Nothing was imported.",
                );
                return;
              }

              setUrlIngestPhase("Creating playlist…");

              const unified = await createUnifiedPlaylistFromLocalScan(
                {
                  playlistName: res.playlistName,
                  files: res.files,
                  trackDisplayNames: res.trackDisplayNames,
                  ...(!hasTracks ? { playlistSourcePath: localPath } : {}),
                },
                tx.defaultGenreMixed,
              );
              if (!unified) {
                setUrlError(tx.urlErrorFailedAdd);
                return;
              }
              onAdd(unified);
              setUrlError(null);
              setUrlValue("");
              setM3uImportBanner({
                imported: res.imported,
                unresolved: res.unresolved.length,
                skipped: res.skipped,
                unresolvedHint: unresolvedM3uSummaryHint(res.unresolved),
                playlistName: res.playlistName,
              });
              setM3uYoutubeResolveContext(buildM3uYoutubeResolveContext(unified, res));
              return;
            } finally {
              if (phaseTimer !== undefined) window.clearTimeout(phaseTimer);
            }
          }

          const scanFolder = desktop?.scanLocalAudioFolder;
          if (typeof scanFolder === "function") {
            const scan = await scanFolder(localPath);
            if (scan.status === "ok") {
              const tracks = scan.files.map((filePath) => ({
                id: crypto.randomUUID(),
                name: titleFromLocalPath(filePath),
                type: "local" as const,
                url: filePath,
              }));
              const res = await fetch("/api/playlists", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: scan.playlistName,
                  url: scan.files[0]!,
                  genre: tx.defaultGenreMixed,
                  type: "local",
                  thumbnail: "",
                  tracks,
                }),
              });
              if (res.ok) {
                const created = (await res.json()) as Playlist;
                onAdd({
                  id: `pl-${created.id}`,
                  title: created.name,
                  genre: created.genre || tx.defaultGenreMixed,
                  cover: created.thumbnail || null,
                  type: "local",
                  url: created.url,
                  origin: "playlist",
                  playlist: created,
                  ...unifiedFoundationHints("playlist", "local", created.url),
                });
                setUrlValue("");
              } else {
                setUrlError(tx.urlErrorFailedAdd);
              }
              return;
            }
            if (scan.status === "error") {
              setUrlError(scan.message || tx.urlErrorFailedAdd);
              return;
            }
            // not_directory: fall through to single-file path
          } else if (isLocalPathLikelyFolderInWebBrowser(localPath)) {
            setUrlError(tx.urlErrorLocalFolderDesktopOnly);
            return;
          }

          const name = titleFromLocalPath(localPath);
          const res = await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              url: localPath,
              genre: tx.defaultGenreMixed,
              type: "local",
              thumbnail: "",
            }),
          });
          if (res.ok) {
            const created = (await res.json()) as Playlist;
            onAdd({
              id: `pl-${created.id}`,
              title: created.name,
              genre: created.genre || tx.defaultGenreMixed,
              cover: created.thumbnail || null,
              type: "local",
              url: created.url,
              origin: "playlist",
              playlist: created,
              ...unifiedFoundationHints("playlist", "local", created.url),
            });
            setUrlValue("");
          } else {
            setUrlError(tx.urlErrorFailedAdd);
          }
        } catch {
          setUrlError(tx.urlErrorFailedAdd);
        } finally {
          ingestingRef.current = false;
          setUrlIngesting(false);
          setUrlIngestPhase(null);
        }
        return;
      }
      if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        setUrlError(tx.urlErrorInvalidUrlOrPath);
        return;
      }
      if (ingestingRef.current) return;
      ingestingRef.current = true;
      setUrlIngesting(true);
      setUrlError(null);
      setYoutubeMixImportUrl(null);
      setExternalMusicResolveHint(null);
      setExternalYtResolvePack(null);
      try {
        const musicUrlIngest = classifyMusicUrlIngest(trimmed);

        if (musicUrlIngest.intent === "unsupported_playlist_or_album") {
          setUrlError(
            "Album or playlist links from this service are not supported yet. Paste a single-track link, or use YouTube, SoundCloud, or a radio/stream URL.",
          );
          return;
        }

        if (musicUrlIngest.intent === "resolve_to_youtube" && musicUrlIngest.provider !== "shazam") {
          if (!isMusicUrlYoutubePickerProvider(musicUrlIngest.provider)) {
            setExternalMusicResolveHint("This music link should be resolved to YouTube.");
            return;
          }

          setUrlIngestPhase("Reading link…");
          const fromPickApi = await parseUrlStorefront(trimmed);
          let parsedPick: ParseUrlJson =
            fromPickApi ??
            ({
              title: "",
              cover: null,
              genre: tx.defaultGenreMixed,
              type: "stream-url",
              isRadio: false,
              ...parseUrlFoundationHints({
                rawUrl: trimmed,
                inferredType: "stream-url",
                isRadio: false,
                isShazam: false,
              }),
            } as ParseUrlJson);

          const queryResult = tryBuildExternalMusicYoutubeSearchQuery(parsedPick, trimmed);
          if (!queryResult.ok) {
            setUrlError("Could not identify the track from this link");
            return;
          }
          const q = queryResult.query.trim();

          /** Picker subtitle: prefer readable title derived from successful query when parse-url stayed weak */
          if (!parsedPick.title?.trim() || isWeakStorefrontParsedTitle(parsedPick.title)) {
            parsedPick = { ...parsedPick, title: q, genre: parsedPick.genre || tx.defaultGenreMixed };
          }

          setUrlIngestPhase("Searching YouTube…");
          const { youtube } = await searchExternal(q);
          const pseudoRow = pseudoM3uRowForExternalMusicPaste({
            parsed: parsedPick,
            searchQuery: q,
            originalUrl: trimmed,
          });
          const { display } = narrowExternalMusicYoutubeDisplay(
            youtube.filter((r): r is YouTubeSearchResult & { type: "youtube" } => r.type === "youtube"),
            pseudoRow,
          );
          if (display.length === 0) {
            setUrlError(tx.urlErrorYoutubeNotFound);
            return;
          }

          setExternalYtResolvePack({
            sourceUrl: trimmed,
            parsed: parsedPick,
            searchQuery: q,
            candidates: display,
          });
          return;
        }

        const ingestHttpsUrl =
          musicUrlIngest.provider === "youtube" || musicUrlIngest.provider === "youtube_music"
            ? getYouTubeVideoId(trimmed)
              ? canonicalYouTubeWatchUrlForPlayback(trimmed)
              : trimmed
            : trimmed;

        const type = inferPlaylistType(trimmed);
        const isRadio = type === "winamp" || !!trimmed.match(/\.(m3u8?|pls|aac|mp3)(\?|$)/i);
        const isShazam = isShazamUrl(trimmed);

        /** Fallback only when `/api/sources/parse-url` fails — must not replace full resolve for normal ingest. */
        const fastPathMeta = {
          title:
            type === "youtube"
              ? tx.providerYouTube
              : type === "soundcloud"
                ? tx.providerSoundCloud
                : type === "spotify"
                  ? tx.providerSpotify
                  : isRadio
                    ? tx.defaultRadioStationName
                    : tx.defaultUntitled,
          cover: type === "youtube" ? getYouTubeThumbnail(trimmed) : null,
          genre: isRadio ? tx.defaultLiveRadioGenre : tx.defaultGenreMixed,
          type: isRadio ? "stream-url" : type,
          isRadio,
        };

        const fromApi = await parseUrl(trimmed);
        const parsed =
          fromApi ??
          ({
            ...fastPathMeta,
            ...parseUrlFoundationHints({
              rawUrl: trimmed,
              inferredType: type,
              isRadio,
              isShazam,
            }),
          } as ParseUrlJson);

        if (isShazam) {
          setUrlIngestPhase("Searching YouTube…");
          const searchQuery = parsed?.artist && parsed?.song
            ? `${parsed.artist} ${parsed.song}`
            : parsed?.title ?? "";
          const { youtube } = await searchExternal(searchQuery);
          const first = youtube.find((r: YouTubeSearchResult) => r.type === "youtube") ?? youtube[0];
          if (!first) {
            setUrlError(tx.urlErrorYoutubeNotFound);
            return;
          }
          const resolvedFirstUrl =
            first.type === "youtube"
              ? await resolveYouTubePlayableUrlForSearch(first.url)
              : first.url;
          setUrlIngestPhase("Creating playlist…");
          const res = await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: parsed?.title ?? tx.defaultUntitled,
              url: resolvedFirstUrl,
              genre: parsed?.genre ?? tx.defaultGenreMixed,
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
              genre: created.genre || tx.defaultGenreMixed,
              cover: created.thumbnail || null,
              type: "youtube",
              url: created.url,
              origin: "playlist",
              playlist: created,
              ...pickUnifiedFoundationFields(parsed as Record<string, unknown>),
            });
            setUrlValue("");
          } else setUrlError(tx.urlErrorFailedAdd);
        } else if (isRadio) {
          setUrlIngestPhase("Creating playlist…");
          const res = await fetch("/api/radio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: parsed?.title ?? tx.defaultUntitled,
              url: trimmed,
              genre: parsed?.genre ?? tx.defaultGenreMixed,
              cover: parsed?.cover ?? null,
            }),
          });
          if (res.ok) {
            const station = (await res.json()) as RadioStream;
            onAdd({
              id: station.id,
              title: station.name,
              genre: station.genre || tx.defaultLiveRadioGenre,
              cover: station.cover || null,
              type: "stream-url",
              url: station.url,
              origin: "radio",
              radio: station,
              ...pickUnifiedFoundationFields(parsed as Record<string, unknown>),
            });
            setUrlValue("");
          } else setUrlError(tx.urlErrorFailedAdd);
        } else {
          const validTypes = ["soundcloud", "youtube", "spotify", "winamp", "local", "stream-url"] as const;
          const apiType = validTypes.includes((parsed?.type ?? type) as (typeof validTypes)[number]) ? (parsed?.type ?? type) : type;
          if (
            apiType === "youtube" &&
            (isYouTubeMixUrl(trimmed) || isYouTubeMultiTrackUrl(trimmed))
          ) {
            setYoutubeMixImportUrl(trimmed);
            return;
          }
          let playableUrl =
            apiType === "youtube"
              ? ingestHttpsUrl
              : trimmed;
          if (apiType === "youtube") {
            setUrlIngestPhase("Searching YouTube…");
            playableUrl = await resolveYouTubePlayableUrlForSearch(playableUrl);
          }
          setUrlIngestPhase("Creating playlist…");
          const res = await fetch("/api/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: parsed?.title ?? tx.defaultUntitled,
              url: playableUrl,
              genre: parsed?.genre ?? tx.defaultGenreMixed,
              type: apiType,
              thumbnail: parsed?.cover ?? "",
              viewCount: parsed?.viewCount,
              durationSeconds: parsed?.durationSeconds,
            }),
          });
          if (res.ok) {
            const created = (await res.json()) as Playlist;
            onAdd({
              id: `pl-${created.id}`,
              title: created.name,
              genre: created.genre || tx.defaultGenreMixed,
              cover: created.thumbnail || null,
              type: created.type as UnifiedSource["type"],
              url: created.url,
              origin: "playlist",
              playlist: created,
              ...pickUnifiedFoundationFields(parsed as Record<string, unknown>),
            });
            setUrlValue("");
          } else setUrlError(tx.urlErrorFailedAdd);
        }
      } catch {
        setUrlError(tx.urlErrorFailedAdd);
      } finally {
        ingestingRef.current = false;
        setUrlIngesting(false);
        setUrlIngestPhase(null);
      }
    },
    [onAdd, router, tx]
  );

  const handleDismissExternalYtPick = useCallback(() => {
    setExternalYtResolvePack(null);
  }, []);

  const handleConfirmExternalYtPick = useCallback(
    async (pack: ExternalMusicYtResolvePack, candidate: YouTubeSearchResult) => {
      setExternalYtSaveBusy(true);
      setUrlError(null);
      try {
        const resolvedUrl =
          candidate.type === "youtube"
            ? await resolveYouTubePlayableUrlForSearch(candidate.url)
            : candidate.url;
        const name = candidate.title.trim() || pack.parsed.title?.trim() || tx.defaultUntitled;
        const genreLine =
          pack.parsed.genre?.trim() || (name ? inferGenre(name) : null) || tx.defaultGenreMixed;
        const res = await fetch("/api/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            url: resolvedUrl,
            genre: genreLine,
            type: "youtube",
            thumbnail: candidate.cover?.trim() || pack.parsed.cover || "",
            viewCount: candidate.viewCount,
            durationSeconds: candidate.durationSeconds,
          }),
        });
        if (res.ok) {
          const created = (await res.json()) as Playlist;
          onAdd({
            id: `pl-${created.id}`,
            title: created.name,
            genre: created.genre || tx.defaultGenreMixed,
            cover: created.thumbnail || null,
            type: "youtube",
            url: created.url,
            origin: "playlist",
            playlist: created,
            ...pickUnifiedFoundationFields(pack.parsed as Record<string, unknown>),
          });
          setUrlValue("");
          setExternalYtResolvePack(null);
        } else setUrlError(tx.urlErrorFailedAdd);
      } catch {
        setUrlError(tx.urlErrorFailedAdd);
      } finally {
        setExternalYtSaveBusy(false);
      }
    },
    [onAdd, tx]
  );

  const notifyM3uPlaylistMerged = useCallback(
    (source: UnifiedSource) => {
      onPlaylistUpdated?.(source);
    },
    [onPlaylistUpdated],
  );

  const handleM3uYoutubeResolveApplied = useCallback((mergedCount: number) => {
    setYoutubeResolveOpen(false);
    setM3uYoutubeResolveContext(null);
    setM3uImportBanner((prev) => {
      if (!prev || mergedCount <= 0) return prev;
      const nextUnresolved = Math.max(0, prev.unresolved - mergedCount);
      return {
        ...prev,
        unresolved: nextUnresolved,
        unresolvedHint: nextUnresolved > 0 ? prev.unresolvedHint : undefined,
      };
    });
  }, []);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (externalYtResolvePack != null || externalYtSaveBusy) return;
    void ingestUrl(urlValue);
  };

  const handleVoiceSearch = useCallback(() => {
    const Win = typeof window !== "undefined" ? window : null;
    const SR = Win && ((Win as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (Win as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
    if (!SR || typeof SR !== "function") return;
    const rec = new (SR as new () => Record<string, unknown>)();
    (rec as Record<string, unknown>).continuous = false;
    (rec as Record<string, unknown>).interimResults = false;
    (rec as Record<string, unknown>).lang = locale === "he" ? "he-IL" : "en-US";
    setListening(true);
    (rec as Record<string, unknown>).onresult = (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => {
      setQuery(e.results[0]?.[0]?.transcript ?? "");
      setShowResults(true);
      setListening(false);
    };
    (rec as Record<string, unknown>).onerror = () => setListening(false);
    (rec as Record<string, unknown>).onend = () => setListening(false);
    (rec as { start: () => void }).start();
  }, [locale]);

  const [voiceSupported, setVoiceSupported] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [hasLinkInDrag, setHasLinkInDrag] = useState(false);

  useEffect(() => {
    setVoiceSupported(
      !!(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      !!(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
    );
  }, []);

  const isDraggingIngestPayload = (e: React.DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    if (types.includes("Files")) return true;
    return types.includes("text/uri-list") || types.includes("text/plain") || types.includes("url");
  };

  const extractIngestFromDrop = (e: React.DragEvent): string | null => {
    const fromElectron = collectElectronFilePathsFromDataTransfer(e.dataTransfer);
    if (fromElectron.length > 0) {
      const useFolderResolve =
        typeof window !== "undefined" &&
        typeof window.syncbizDesktop?.scanLocalAudioFolder === "function";
      const pick = useFolderResolve
        ? resolveDesktopFolderDropPath(fromElectron)
        : fromElectron[0]!;
      const p = normalizeLocalFilePathInput(pick);
      if (p) return p;
    }
    const uriList = e.dataTransfer.getData("text/uri-list");
    const plain = e.dataTransfer.getData("text/plain");
    const raw = (uriList || plain || "").trim();
    const first = raw.split(/[\r\n]+/)[0]?.trim() ?? "";
    if (!first) return null;
    if (first.startsWith("http://") || first.startsWith("https://")) return first;
    return normalizeLocalFilePathInput(first);
  };

  const handleDropUrl = useCallback(
    (url: string) => {
      setUrlValue(url);
      void ingestUrl(url);
    },
    [ingestUrl]
  );

  const handleIngestDrop = (e: React.DragEvent) => {
    setDragOver(false);
    setHasLinkInDrag(false);
    e.preventDefault();
    e.stopPropagation();
    const payload = extractIngestFromDrop(e);
    logDesktopLibraryIngestDrop(e, payload);
    if (payload) handleDropUrl(payload);
  };

  const handleAddAllYoutube = useCallback(
    async () => {
      for (const r of youtubeResults) {
        const genre = inferGenre(r.title, query);
        let playableUrl = r.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(r.url) : r.url;
        if (r.type === "youtube" && !getYouTubeVideoId(playableUrl) && getYouTubeVideoId(r.url)) {
          playableUrl = r.url;
        }
        const created = await createPlaylistFromUrl(playableUrl, { title: r.title, genre, cover: r.cover, type: r.type, viewCount: r.viewCount, durationSeconds: r.durationSeconds });
        if (created) {
          const unified: UnifiedSource = {
            id: `pl-${created.id}`,
            title: created.name,
            genre: created.genre || tx.defaultGenreMixed,
            cover: created.thumbnail || null,
            type: created.type as UnifiedSource["type"],
            url: created.url,
            origin: "playlist",
            playlist: created,
            ...unifiedFoundationHints("playlist", created.type as UnifiedSource["type"], created.url),
          };
          onAdd(unified);
        }
      }
      setQuery("");
      setYoutubeResults([]);
      setRadioResults([]);
      setLocalResults([]);
      setShowResults(false);
    },
    [query, youtubeResults, onAdd, router, tx]
  );

  const handleAddYoutube = useCallback(
    async (r: YouTubeSearchResult) => {
      const genre = inferGenre(r.title, query);
      let playableUrl = r.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(r.url) : r.url;
      if (r.type === "youtube" && !getYouTubeVideoId(playableUrl) && getYouTubeVideoId(r.url)) {
        playableUrl = r.url;
      }
      const created = await createPlaylistFromUrl(playableUrl, { title: r.title, genre, cover: r.cover, type: r.type, viewCount: r.viewCount, durationSeconds: r.durationSeconds });
      if (created) {
        const unified: UnifiedSource = {
          id: `pl-${created.id}`,
          title: created.name,
          genre: created.genre || tx.defaultGenreMixed,
          cover: created.thumbnail || null,
          type: created.type as UnifiedSource["type"],
          url: created.url,
          origin: "playlist",
          playlist: created,
          ...unifiedFoundationHints("playlist", created.type as UnifiedSource["type"], created.url),
        };
        onAdd(unified);
        setQuery("");
        setYoutubeResults([]);
        setRadioResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [query, onAdd, router, tx]
  );

  const handleAddRadio = useCallback(
    async (r: RadioSearchResult) => {
      const res = await fetch("/api/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.title,
          url: r.url,
          genre: r.genre || tx.defaultGenreRadioShort,
          cover: r.cover,
        }),
      });
      if (res.ok) {
        const station = (await res.json()) as RadioStream;
        onAdd(radioToUnified(station));
        setQuery("");
        setRadioResults([]);
        setYoutubeResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [onAdd, tx]
  );

  const handlePlayRadio = useCallback(
    async (r: RadioSearchResult) => {
      const res = await fetch("/api/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.title,
          url: r.url,
          genre: r.genre || tx.defaultGenreRadioShort,
          cover: r.cover,
        }),
      });
      if (res.ok) {
        const station = (await res.json()) as RadioStream;
        const unified = radioToUnified(station);
        effectivePlaySource(unified);
        setQuery("");
        setRadioResults([]);
        setYoutubeResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [effectivePlaySource, router, tx]
  );

  const handlePlayYoutube = useCallback(
    async (r: YouTubeSearchResult) => {
      const genre = inferGenre(r.title, query);
      let playableUrl = r.type === "youtube" ? await resolveYouTubePlayableUrlForSearch(r.url) : r.url;
      if (r.type === "youtube" && !getYouTubeVideoId(playableUrl) && getYouTubeVideoId(r.url)) {
        playableUrl = r.url;
      }
      const created = await createPlaylistFromUrl(playableUrl, { title: r.title, genre, cover: r.cover, type: r.type, viewCount: r.viewCount, durationSeconds: r.durationSeconds });
      if (created) {
        const sourceType = created.type as UnifiedSource["type"];
        const u: UnifiedSource = {
          id: `pl-${created.id}`,
          title: created.name,
          genre: created.genre || tx.defaultGenreMixed,
          cover: created.thumbnail || null,
          type: sourceType,
          url: created.url,
          origin: "playlist",
          playlist: created,
          ...unifiedFoundationHints("playlist", sourceType, created.url),
        };
        onAdd(u);
        effectivePlaySource(u);
        setQuery("");
        setYoutubeResults([]);
        setRadioResults([]);
        setLocalResults([]);
        setShowResults(false);
      }
    },
    [query, effectivePlaySource, router, onAdd, tx]
  );

  return (
    <div ref={panelRef} className="relative">
      {/* Tesla-style drop zone – clean, minimal, inviting */}
      <div
        onPaste={(e) => {
          const text = e.clipboardData?.getData("text/plain")?.trim();
          if (!text) return;
          if (normalizeLocalFilePathInput(text) || text.startsWith("http://") || text.startsWith("https://")) {
            e.preventDefault();
            e.stopPropagation();
            setUrlValue(text);
            void ingestUrl(text);
          }
        }}
        onDrop={handleIngestDrop}
        onDragOverCapture={(e) => {
          if (isDraggingIngestPayload(e)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragOver={(e) => {
          if (isDraggingIngestPayload(e)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDragOver(true);
            setHasLinkInDrag(true);
          }
        }}
        onDragLeave={() => {
          setDragOver(false);
          setHasLinkInDrag(false);
        }}
        className={`relative overflow-hidden rounded-xl border transition-all duration-200 sb-library-ingest-shell ${
          ingestStripBusy ? `sb-library-ingest-shell--busy ${ingestShellPhaseClass}` : ""
        } ${
          dragOver && hasLinkInDrag
            ? "border-[#1ed760]/80 bg-[#1ed760]/10 shadow-[0_0_24px_rgba(30,215,96,0.2)]"
            : "border-slate-800/80 bg-slate-950/98 shadow-[0_4px_24px_rgba(0,0,0,0.4),0_0_0_1px_rgba(30,215,96,0.08)] hover:border-slate-700/80"
        }`}
      >
        {ingestStripBusy ? <div className="sb-library-ingest-wave" aria-hidden /> : null}
        <div className="sb-library-ingest-inner">
          {/* Single compact control row – Add centered */}
          <form
          noValidate
          onSubmit={handleUrlSubmit}
          className="flex flex-nowrap items-center gap-2.5 px-3 py-2"
          onDragOverCapture={(e) => {
            if (isDraggingIngestPayload(e)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDragOver={(e) => {
            if (isDraggingIngestPayload(e)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={handleIngestDrop}
        >
          {/* URL input */}
          <div className={`relative min-w-0 flex-1 ${controlHeight}`}>
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </span>
            <input
              type="text"
              autoComplete="off"
              value={urlValue}
              onChange={(e) => {
                setYoutubeMixImportUrl(null);
                setExternalMusicResolveHint(null);
                setExternalYtResolvePack(null);
                setExternalYtSaveBusy(false);
                setUrlError(null);
                setM3uImportBanner(null);
                setM3uYoutubeResolveContext(null);
                setYoutubeResolveOpen(false);
                setUrlValue(e.target.value);
              }}
              onDragOver={(e) => {
                if (
                  e.dataTransfer?.types?.includes("Files") ||
                  e.dataTransfer?.types?.includes("text/uri-list") ||
                  e.dataTransfer?.types?.includes("text/plain")
                ) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={handleIngestDrop}
              placeholder={t.addUrlOrPathPlaceholder ?? t.addUrlPlaceholder ?? "Add URL or local path…"}
              disabled={urlIngesting || externalYtSaveBusy}
              className={`${inputBase} ${controlHeight} pl-9 pr-3`}
            />
          </div>

          {/* Add button – centered */}
          <div className="flex shrink-0 justify-center">
            <button
              type="submit"
              disabled={
                urlIngesting ||
                externalYtSaveBusy ||
                externalYtResolvePack != null ||
                !urlValue.trim()
              }
              className={`${addBtn} ${controlHeight}`}
            >
              {externalYtSaveBusy
                ? "Saving…"
                : urlIngesting
                  ? urlIngestPhase ?? (t.adding ?? "Adding…")
                  : t.add ?? "Add"}
            </button>
          </div>

          {/* Search Library / YouTube + Mic */}
          <div
            className={`relative flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-slate-800/80 bg-slate-800/80 ring-1 ring-slate-700/60 backdrop-blur-sm transition-all focus-within:border-[#1ed760]/70 focus-within:ring-2 focus-within:ring-[#1ed760]/30 ${
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
                if (hasRadio && radioResults.length > 0) {
                  void handlePlayRadio(radioResults[0]);
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
            disabled={urlIngesting}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setMusicBankLocalResults([]);
                setLocalResults([]);
                setYoutubeResults([]);
                setRadioResults([]);
                setShowResults(false);
                inputRef.current?.focus();
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
              aria-label={t.clearSearchAria}
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
              <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                <path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          )}
          </div>
        </form>
        </div>
      </div>

      {urlIngestPhase ? (
        <p className="mt-1.5 text-sm font-medium text-cyan-300/95" role="status" aria-live="polite">
          {urlIngestPhase}
        </p>
      ) : null}
      {urlError && <p className="mt-1.5 text-xs text-amber-400">{urlError}</p>}
      {externalYtResolvePack ? (
        <ExternalMusicYoutubePickerPanel
          pack={externalYtResolvePack}
          saveBusy={externalYtSaveBusy}
          onDismiss={handleDismissExternalYtPick}
          onPick={(candidate) => {
            void handleConfirmExternalYtPick(externalYtResolvePack, candidate);
          }}
        />
      ) : null}
      {externalMusicResolveHint ? (
        <div
          className="mt-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.07] px-3 py-2.5 text-sm leading-relaxed text-cyan-50/95"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 flex-1">{externalMusicResolveHint}</p>
            <button
              type="button"
              className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/90 hover:bg-white/10"
              onClick={() => setExternalMusicResolveHint(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {m3uImportBanner ? (
        <div
          className={`mt-1.5 rounded-lg border px-3 py-2.5 text-sm ${
            m3uImportBanner.error
              ? "border-rose-500/35 bg-rose-500/[0.06] text-rose-100/95"
              : "border-cyan-500/30 bg-cyan-500/[0.07] text-cyan-50/95"
          }`}
          role="status"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 leading-relaxed">
              <span className="font-semibold">Playlist import:</span> {m3uImportBanner.imported} imported
              {m3uImportBanner.unresolved > 0 ? ` · ${m3uImportBanner.unresolved} missing / unresolved` : ""}
              {m3uImportBanner.skipped > 0 ? ` · ${m3uImportBanner.skipped} skipped` : ""}
              {m3uImportBanner.playlistName ? (
                <span className="mt-1 block font-medium text-white/95">“{m3uImportBanner.playlistName}”</span>
              ) : null}
              {m3uImportBanner.error ? (
                <span className="mt-1 block text-xs opacity-95">{m3uImportBanner.error}</span>
              ) : null}
              {m3uImportBanner.unresolvedHint ? (
                <span
                  className={`mt-1 block font-mono text-[11px] leading-snug ${
                    m3uImportBanner.error ? "text-rose-100/75" : "text-cyan-100/70"
                  }`}
                >
                  Unresolved hint: {m3uImportBanner.unresolvedHint}
                </span>
              ) : null}
            </p>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {m3uYoutubeResolveContext && m3uImportBanner.unresolved > 0 && !m3uImportBanner.error ? (
                <button
                  type="button"
                  disabled={urlIngesting}
                  onClick={() => setYoutubeResolveOpen(true)}
                  className="rounded-lg bg-gradient-to-b from-[#1ed760]/90 to-[#1db954]/90 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)] transition hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
                >
                  Find missing on YouTube
                </button>
              ) : null}
              <button
                type="button"
                className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/90 hover:bg-white/10"
                onClick={() => {
                  setM3uImportBanner(null);
                  setM3uYoutubeResolveContext(null);
                  setYoutubeResolveOpen(false);
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {youtubeMixImportUrl ? (
        <YouTubeMixImportPanelShell
          sourceUrl={youtubeMixImportUrl}
          onDismiss={() => setYoutubeMixImportUrl(null)}
        />
      ) : null}
      {youtubeResolveOpen && m3uYoutubeResolveContext ? (
        <M3uYoutubeResolveModal
          context={m3uYoutubeResolveContext}
          defaultGenre={tx.defaultGenreMixed}
          onClose={() => setYoutubeResolveOpen(false)}
          onPlaylistMerged={notifyM3uPlaylistMerged}
          onApplied={handleM3uYoutubeResolveApplied}
        />
      ) : null}

      {/* Search results dropdown */}
      {showResults && hasQuery && (
        <div className="absolute left-0 right-0 top-full z-50 max-h-[60vh] overflow-y-auto rounded-b-xl border border-t-0 border-slate-800/80 bg-slate-900 ring-1 ring-slate-700/60 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
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
              {hasMusicBankLocal && (
                <div className="border-b border-slate-800/60 p-2">
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
                          {source.cover ? (
                            <img src={source.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <TrackMediaPlaceholder chip="LOCAL" className="h-full w-full" showCornerBadge={false} />
                          )}
                          <span className="pointer-events-none absolute bottom-0.5 left-0.5">
                            <CompactSourceBadge chip="LOCAL" />
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
                              effectivePlaySource(source);
                              setQuery("");
                              setMusicBankLocalResults([]);
                              setLocalResults([]);
                              setYoutubeResults([]);
                              setRadioResults([]);
                              setShowResults(false);
                            }}
                            className="inline-flex h-8 items-center justify-center rounded-lg bg-[#1db954] px-2.5 text-xs font-medium text-white transition hover:bg-[#1ed760]"
                          >
                            {t.play}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasLocal && (
                <div className="border-b border-slate-800/60 p-2">
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.localResults}</p>
                  <div className="space-y-0.5">
                    {localResults.map((source) => {
                      const libChip = inferTrackSourceChip(source);
                      return (
                      <div key={source.id} className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                          {source.cover ? (
                            <img src={source.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <TrackMediaPlaceholder chip={libChip} className="h-full w-full" showCornerBadge={false} />
                          )}
                          <span className="pointer-events-none absolute bottom-0.5 left-0.5">
                            <CompactSourceBadge chip={libChip} />
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{source.title}</p>
                          {source.genre && <p className="text-[10px] text-slate-500">{source.genre}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => effectivePlaySource(source)}
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
                            <ActionButtonEdit href={`/playlists/${source.playlist.id}/edit`} variant="player" title={t.editPlaylist} aria-label={t.editPlaylist} />
                          )}
                          {source.origin === "radio" && source.radio && (
                            <ActionButtonEdit href={`/radio/${source.radio.id}/edit`} variant="player" title={t.radioEdit} aria-label={t.radioEdit} />
                          )}
                          {source.origin === "source" && source.source && (
                            <ActionButtonEdit href={`/sources/${source.source.id}/edit`} variant="player" title={t.edit} aria-label={t.edit} />
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {hasRadio && (
                <div className="p-2">
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.radioResults ?? "Radio stations"}</p>
                  <div className="space-y-0.5">
                    {radioResults.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-800/80">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                          {r.cover ? (
                            <img src={r.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <TrackMediaPlaceholder chip="RADIO" className="h-full w-full" showCornerBadge={false} />
                          )}
                          <span className="pointer-events-none absolute bottom-0.5 left-0.5 z-[1]">
                            <CompactSourceBadge chip="RADIO" />
                          </span>
                          <span className="absolute bottom-0.5 right-0.5 rounded bg-rose-500/92 px-1 py-[1px] text-[8px] font-semibold uppercase tracking-wide text-white">
                            {t.live ?? "LIVE"}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{r.title}</p>
                          <p className="text-[10px] text-slate-500">
                            {r.genre && r.genre !== "Radio" && r.genre !== tx.defaultGenreRadioShort
                              ? r.genre
                              : tx.defaultGenreRadioShort}
                          </p>
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
                            <TrackMediaPlaceholder chip="YT" className="h-full w-full" showCornerBadge={false} />
                          )}
                          <span className="pointer-events-none absolute bottom-0.5 left-0.5">
                            <CompactSourceBadge chip="YT" />
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{r.title}</p>
                          <p className="text-[10px] text-slate-500">
                            {tx.providerYouTube}
                            {(() => {
                              const g = inferGenre(r.title, query);
                              return g && g !== "Mixed" && g !== tx.defaultGenreMixed ? (
                                <span className="ml-1.5 text-slate-400">• {g}</span>
                              ) : null;
                            })()}
                            {r.viewCount != null && (
                              <span className="ml-1.5 text-slate-400">
                                • {formatViewCount(r.viewCount)} {t.views ?? "views"}
                              </span>
                            )}
                            {r.durationSeconds != null && r.durationSeconds > 0 && (
                              <span className="ml-1.5 text-slate-400">
                                • {formatDuration(r.durationSeconds)}
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
