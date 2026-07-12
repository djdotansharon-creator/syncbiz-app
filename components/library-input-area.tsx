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
import { searchAll, searchExternal, type YouTubeSearchResult, type RadioSearchResult, type CatalogSearchResult } from "@/lib/search-service";
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
import {
  fetchSpotifyPlaylistPreview,
  normalizeSpotifyShareInput,
  parseSpotifyPlaylistOrAlbumUrl,
  runSpotifyAutoBuildYoutubeSearch,
  saveAutoBuiltYoutubePlaylist,
  spotifyTracksToUnresolvedRows,
  type SpotifyAutoBuildResolvedPick,
} from "@/lib/spotify-playlist-import-client";
import { unifiedSourceFromFetchedPlaylist } from "@/lib/local-music-library-playlist";
import type { M3uUnresolvedImportRow } from "@/lib/m3u-youtube-resolve-shared";
import { PlainTracklistPasteModal } from "@/components/plain-tracklist-paste-modal";
import {
  PASTED_TRACKLIST_MAX,
  pastedTracklistRowsToUnresolvedRows,
} from "@/lib/plain-tracklist-parser";

/** Animated shell phase for M3U / URL ingest (`sb-library-ingest-shell--*` in CSS). */
function libraryUrlIngestPhaseClass(phase: string | null): string {
  const p = (phase ?? "").toLowerCase();
  if (p.startsWith("reading")) return "sb-library-ingest-shell--read";
  if (p.includes("resolving")) return "sb-library-ingest-shell--resolve";
  if (p.includes("youtube")) return "sb-library-ingest-shell--youtube";
  if (p.includes("creating")) return "sb-library-ingest-shell--save";
  return "sb-library-ingest-shell--neutral";
}

const controlHeight = "h-8";
const inputBase =
  "w-full bg-transparent py-2 text-sm text-[#f5f5f7] placeholder:text-[#6e6e73] transition-colors focus:outline-none disabled:opacity-60";
const addBtn =
  "shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.06] px-3 text-xs font-semibold text-[#f5f5f7] transition-colors hover:border-white/[0.18] hover:bg-white/[0.1] disabled:opacity-30 disabled:pointer-events-none";

/* ── Search results — Spotify-scale rows in the player language ── */
const RESULT_ROW =
  "flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.05]";
const RESULT_THUMB =
  "relative h-11 w-[74px] shrink-0 overflow-hidden rounded-lg bg-[#101014]";
const RESULT_TITLE = "truncate text-[15px] font-semibold leading-snug text-[#f5f5f7]";
const RESULT_META = "mt-0.5 truncate text-xs text-[#a1a1a6]";
const RESULT_SECTION_HEAD =
  "mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e6e73]";
const RESULT_PLAY_BTN =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[#111114] shadow-[0_2px_10px_-3px_rgba(0,0,0,0.6)] transition-colors hover:bg-white active:scale-95";
const RESULT_GHOST_BTN =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-white/[0.1] px-3 text-xs font-medium text-[#a1a1a6] transition-colors hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white";

function ResultPlayIcon() {
  return (
    <svg className="ml-0.5 h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

/** Inline platform logo shown right after the title — a logo, never letters. */
function ResultPlatformLogo({ kind }: { kind: "youtube" | "radio" | "local" | null }) {
  if (!kind) return null;
  if (kind === "youtube") {
    return (
      <svg className="h-3.5 w-[18px] shrink-0" viewBox="0 0 24 24" aria-label="YouTube">
        <path
          d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"
          fill="#ff0000"
        />
        <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#ffffff" />
      </svg>
    );
  }
  if (kind === "radio") {
    return (
      <svg className="h-3.5 w-3.5 shrink-0 text-[#fb7185]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Radio">
        <rect x="2" y="8" width="20" height="12" rx="2" />
        <path d="M6 8L18 3" />
        <circle cx="8" cy="14" r="2.5" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-3.5 shrink-0 text-[#93c5fd]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Local">
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 22h8M12 18v4" />
    </svg>
  );
}

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
  /** Build catalog-first AI playlist from the library search query (prompt mode). */
  onAiPlaylistFromSearchPrompt?: (prompt: string) => void | Promise<void>;
};

export function LibraryInputArea({
  onAdd,
  playSourceOverride,
  onPlaylistUpdated,
  onAiPlaylistFromSearchPrompt,
}: Props) {
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
  const [pasteTracklistOpen, setPasteTracklistOpen] = useState(false);
  /**
   * Set when a Spotify playlist comes back 403/`playlist_blocked`. Surfaces an inline
   * "Paste tracklist" button next to the error so the operator can jump straight into
   * the Stage 6D-Lite flow without re-typing the URL or hunting for the top-level button.
   */
  const [spotifyBlockedShowPasteCta, setSpotifyBlockedShowPasteCta] = useState(false);
  /**
   * Stage 6E-A — when a blocked playlist could be unlocked by connecting Spotify
   * (`connectAvailable` from the preview route) the rose panel also shows a
   * "Connect Spotify" / "Reconnect Spotify" button. `connectAvailable: false`
   * means the user is already connected but lacks access to that specific
   * playlist, so only Paste tracklist is offered.
   */
  const [spotifyConnectAvailable, setSpotifyConnectAvailable] = useState(false);
  const [spotifyNeedsReauth, setSpotifyNeedsReauth] = useState(false);
  /**
   * Stage 6D-Auto — completion summary surfaced after `runSpotifyAutoBuildYoutubeSearch`
   * plus `saveAutoBuiltYoutubePlaylist` succeed. Carries the just-created playlist id +
   * the unresolved rows so the operator can opt into the legacy resolver modal for the
   * missing tracks (mode `append_to_existing_youtube`). Cleared when the operator
   * dismisses the banner or opens the modal.
   */
  const [spotifyAutoBuildSummary, setSpotifyAutoBuildSummary] = useState<{
    /**
     * Empty string when `resolvedCount === 0` — auto-build produced no resolved rows,
     * so no playlist was POSTed and the "Review missing tracks" CTA opens the resolver
     * in `create_youtube_only` mode (which will POST a fresh playlist on Apply).
     * Non-empty string when at least one row resolved — CTA opens the resolver in
     * `append_to_existing_youtube` mode against this id.
     */
    playlistId: string;
    playlistName: string;
    resolvedCount: number;
    totalCount: number;
    missing: M3uUnresolvedImportRow[];
    /**
     * `playlistOrder` values for the already-resolved tracks, in playlist position.
     * Threaded through `context.resolvedSourceOrders` so the resolver can interleave
     * reviewed missing tracks by original Spotify order instead of appending at end.
     */
    resolvedOrders: number[];
    sourceLabel: string;
  } | null>(null);

  const [query, setQuery] = useState("");
  const [musicBankLocalResults, setMusicBankLocalResults] = useState<UnifiedSource[]>([]);
  const [localResults, setLocalResults] = useState<UnifiedSource[]>([]);
  const [youtubeResults, setYoutubeResults] = useState<YouTubeSearchResult[]>([]);
  const [radioResults, setRadioResults] = useState<RadioSearchResult[]>([]);
  const [catalogResults, setCatalogResults] = useState<CatalogSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [aiPlaylistBusy, setAiPlaylistBusy] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchQueryRef = useRef("");

  const hasQuery = query.trim().length >= 2;
  const hasMusicBankLocal = musicBankLocalResults.length > 0;
  const hasLocal = localResults.length > 0;
  const hasYoutube = youtubeResults.length > 0;
  const hasRadio = radioResults.length > 0;
  const hasCatalog = catalogResults.length > 0;
  const hasResults = hasMusicBankLocal || hasLocal || hasYoutube || hasRadio || hasCatalog;

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
      setCatalogResults([]);
      return;
    }
    searchQueryRef.current = q;
    setSearching(true);
    setYoutubeResults([]);
    setRadioResults([]);
    setCatalogResults([]);
    try {
      const [allRes, mblRes] = await Promise.all([
        searchAll(sources, q),
        searchMusicBankLocalSnapshot(q, 25),
      ]);
      if (searchQueryRef.current === q) {
        setLocalResults(allRes.internal);
        setYoutubeResults(allRes.external.youtube);
        setRadioResults(allRes.external.radio);
        setCatalogResults(allRes.external.catalog);
        setMusicBankLocalResults(mblRes);
      }
    } catch {
      if (searchQueryRef.current === q) {
        setMusicBankLocalResults([]);
        setLocalResults([]);
        setYoutubeResults([]);
        setRadioResults([]);
        setCatalogResults([]);
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
      setCatalogResults([]);
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

  /**
   * Single entry point for any code path that mutates `urlValue` in response to user
   * input (typed change, panel-level paste, drag-and-drop). Clearing stale resolver
   * states here is what keeps the Add button clickable after a previous flow left
   * `externalYtResolvePack` non-null — without this the disabled condition at the
   * submit button latches on. `externalYtSaveBusy` is only ever flipped on by
   * `handleConfirmExternalYtPick`, which can only run while the picker is mounted
   * (i.e. while `externalYtResolvePack != null`); clearing the pack here means no
   * save is observably in-flight, so resetting the busy flag alongside is safe.
   */
  const applyUrlInputValue = useCallback((next: string) => {
    setYoutubeMixImportUrl(null);
    setExternalMusicResolveHint(null);
    setExternalYtResolvePack(null);
    setExternalYtSaveBusy(false);
    setUrlError(null);
    setSpotifyBlockedShowPasteCta(false);
    setSpotifyConnectAvailable(false);
    setSpotifyNeedsReauth(false);
    setM3uImportBanner(null);
    setM3uYoutubeResolveContext(null);
    setYoutubeResolveOpen(false);
    setSpotifyAutoBuildSummary(null);
    setUrlValue(next);
  }, []);

  const ingestUrl = useCallback(
    async (url: string) => {
      /**
       * Normalize any Spotify URI-scheme share (`spotify:album:<id>` /
       * `spotify:playlist:<id>`) to the canonical HTTPS URL up front. After this line every
       * downstream check — `classifyMusicUrlIngest`, `parseSpotifyPlaylistOrAlbumUrl`,
       * the legacy URL branches — sees a uniform `https://open.spotify.com/...` shape and
       * routes albums into the new preview flow exactly the same way as pasted HTTPS links.
       */
      const trimmed = normalizeSpotifyShareInput(url.trim());
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
      setSpotifyBlockedShowPasteCta(false);
      setYoutubeMixImportUrl(null);
      setExternalMusicResolveHint(null);
      setExternalYtResolvePack(null);
      try {
        const musicUrlIngest = classifyMusicUrlIngest(trimmed);

        if (musicUrlIngest.intent === "unsupported_playlist_or_album") {
          /**
           * Spotify playlist/album → Spotify Web API client-credentials preview → feed every
           * track into the existing M3U YouTube resolver modal in `create_youtube_only` mode.
           * No audio upload, no CatalogItem (type=youtube + non-local urls skip catalog for
           * local files only — and we don't write Spotify URLs anywhere). Album/playlist URLs
           * from other services still get the legacy "unsupported" error below.
           */
          const spotifyHit =
            musicUrlIngest.provider === "spotify" ? parseSpotifyPlaylistOrAlbumUrl(trimmed) : null;
          if (spotifyHit) {
            /**
             * Stage 6D-Auto — Spotify album / public playlist Auto-Build mode.
             *
             * The Spotify preview gives us artist + title + order with high fidelity, so
             * surfacing the big "Match tracks on YouTube" picker for every row is too much
             * friction. Instead:
             *   1. fetch the Spotify tracklist;
             *   2. search YouTube for each row and auto-apply the top *valid* candidate
             *      (`runSpotifyAutoBuildYoutubeSearch` already prefers the existing
             *      official-first / Topic / VEVO / confidence ranking inside the narrower);
             *   3. POST a YouTube-only playlist with the resolved rows in Spotify order.
             *
             * Missing rows (rows the scorer rejected) are stashed in
             * `spotifyAutoBuildSummary` so the operator can opt into the legacy modal for
             * manual review via the "Review missing tracks" CTA — the big resolver remains
             * fallback only, never the default Spotify flow.
             *
             * Blocked playlists (personalized / Made-For-You / private) still 403/404 and
             * route into the paste-tracklist CTA below, unchanged from Stage 6D-B.
             */
            setUrlIngestPhase("Reading Spotify…");
            const preview = await fetchSpotifyPlaylistPreview(trimmed);
            if (preview.status === "not_configured") {
              setUrlError("Spotify import is not configured.");
              return;
            }
            if (preview.status === "playlist_blocked") {
              setUrlError(
                preview.message ||
                  "Spotify blocked access to this playlist. You can paste the tracklist manually, try a Spotify album, or connect Spotify account later.",
              );
              setSpotifyBlockedShowPasteCta(true);
              /**
               * Stage 6E-A — if connecting Spotify could unlock this playlist, remember
               * the URL so the post-OAuth return can auto-retry the import, and surface
               * the Connect/Reconnect button in the rose panel.
               */
              setSpotifyConnectAvailable(preview.connectAvailable === true);
              setSpotifyNeedsReauth(preview.needsReauth === true);
              if (preview.connectAvailable === true && typeof window !== "undefined") {
                try {
                  window.sessionStorage.setItem("sb_spotify_pending_url", trimmed);
                } catch {
                  /* sessionStorage unavailable (private mode) — connect still works, just no auto-retry */
                }
              }
              return;
            }
            if (preview.status === "error") {
              setUrlError(preview.message || tx.urlErrorFailedAdd);
              return;
            }
            const unresolvedRows = spotifyTracksToUnresolvedRows(preview.tracks);
            if (unresolvedRows.length === 0) {
              setUrlError("No tracks were returned for this Spotify link.");
              return;
            }
            const kindLabel = preview.kind === "album" ? "Spotify album" : "Spotify playlist";
            const ownerSuffix = preview.ownerName?.trim() ? ` — ${preview.ownerName.trim()}` : "";
            const sourceLabelBase = `${kindLabel}${ownerSuffix}`;

            setUrlError(null);
            setSpotifyBlockedShowPasteCta(false);
            setM3uImportBanner(null);
            setSpotifyAutoBuildSummary(null);
            setUrlValue("");

            setUrlIngestPhase(`Finding YouTube matches 0/${unresolvedRows.length}…`);
            const outcome = await runSpotifyAutoBuildYoutubeSearch({
              rows: unresolvedRows,
              onProgress: (p) => {
                if (p.phase === "searching") {
                  setUrlIngestPhase(`Finding YouTube matches ${p.done}/${p.total}…`);
                }
              },
            });

            /**
             * 0/N resolved → there is nothing safe to save automatically. Per product:
             * the big resolver must be user-triggered fallback only, never opened
             * automatically. Surface the inline summary "No YouTube matches found.
             * 0/N tracks added." with a "Review missing tracks" CTA; the operator
             * opens the resolver themselves when they want to manually pick.
             */
            if (outcome.resolved.length === 0) {
              setSpotifyAutoBuildSummary({
                playlistId: "",
                playlistName: preview.name,
                resolvedCount: 0,
                totalCount: unresolvedRows.length,
                missing: outcome.missing,
                resolvedOrders: [],
                sourceLabel: sourceLabelBase,
              });
              setUrlIngestPhase(null);
              return;
            }

            setUrlIngestPhase("Creating playlist…");
            const created = await saveAutoBuiltYoutubePlaylist({
              playlistName: preview.name,
              defaultGenre: tx.defaultGenreMixed,
              resolved: outcome.resolved as readonly SpotifyAutoBuildResolvedPick[],
            });
            const unified = unifiedSourceFromFetchedPlaylist(created, tx.defaultGenreMixed);
            onPlaylistUpdated?.(unified);

            setSpotifyAutoBuildSummary({
              playlistId: created.id,
              playlistName: created.name,
              resolvedCount: outcome.resolved.length,
              totalCount: unresolvedRows.length,
              missing: outcome.missing,
              resolvedOrders: outcome.resolved.map((r) => r.order),
              sourceLabel: sourceLabelBase,
            });
            setUrlIngestPhase(null);
            return;
          }
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

  const handleM3uYoutubeResolveApplied = useCallback((mergedOrders: readonly number[]) => {
    setYoutubeResolveOpen(false);
    setM3uYoutubeResolveContext(null);
    const mergedCount = mergedOrders.length;
    setM3uImportBanner((prev) => {
      if (!prev || mergedCount <= 0) return prev;
      const nextUnresolved = Math.max(0, prev.unresolved - mergedCount);
      return {
        ...prev,
        unresolved: nextUnresolved,
        unresolvedHint: nextUnresolved > 0 ? prev.unresolvedHint : undefined,
      };
    });
    /**
     * Spotify Auto-Build summary bookkeeping after the resolver applies:
     *   - 0-resolved fallback (`prev.playlistId === ""`): the resolver POSTed a fresh
     *     playlist via `create_youtube_only`. The summary represented "nothing created"
     *     which is no longer true; just clear it (the library refresh from
     *     `onPlaylistUpdated` is the visible feedback).
     *   - Append fallback (`prev.playlistId !== ""`): filter `missing` by the exact
     *     `playlistOrder` set the operator picked (NOT slice(mergedCount) — picks can
     *     be non-contiguous). Bump `resolvedCount` and `resolvedOrders` so a subsequent
     *     review respects the new playlist contents. Clear the summary once everything
     *     is accounted for.
     */
    setSpotifyAutoBuildSummary((prev) => {
      if (!prev || mergedCount <= 0) return prev;
      if (!prev.playlistId) return null;
      const mergedSet = new Set(mergedOrders);
      const remaining = prev.missing.filter((r) => !mergedSet.has(r.playlistOrder));
      const nextResolved = Math.min(prev.totalCount, prev.resolvedCount + mergedCount);
      if (remaining.length === 0 && nextResolved >= prev.totalCount) return null;
      const nextResolvedOrders = [...prev.resolvedOrders, ...mergedOrders].sort((a, b) => a - b);
      return {
        ...prev,
        resolvedCount: nextResolved,
        missing: remaining,
        resolvedOrders: nextResolvedOrders,
      };
    });
  }, []);

  const handleReviewMissingAutoBuildTracks = useCallback(() => {
    const summary = spotifyAutoBuildSummary;
    if (!summary || summary.missing.length === 0) return;
    /**
     * Mode pivots on whether a playlist already exists for this Auto-Build run:
     *   - `playlistId === ""` → 0-resolved fallback. The resolver POSTs a new YouTube
     *     playlist via `create_youtube_only` on Apply.
     *   - `playlistId !== ""` → resolved > 0; missing rows are merged into the existing
     *     playlist via `append_to_existing_youtube` with order-preserving interleave.
     */
    const isAppend = summary.playlistId !== "";
    setM3uYoutubeResolveContext({
      playlistId: summary.playlistId,
      playlistName: summary.playlistName,
      files: [],
      trackDisplayNames: [],
      resolvedSourceOrders: isAppend ? summary.resolvedOrders : [],
      unresolvedRows: summary.missing,
      mode: isAppend ? "append_to_existing_youtube" : "create_youtube_only",
      sourceLabel: `${summary.sourceLabel} — review ${summary.missing.length} missing track${summary.missing.length === 1 ? "" : "s"}`,
    });
    setYoutubeResolveOpen(true);
  }, [spotifyAutoBuildSummary]);

  /**
   * Stage 6D-Lite — bridge between the paste-tracklist textarea modal and the
   * shared bulk YouTube resolver. The resolver is reused unchanged in
   * `create_youtube_only` mode: it does the YouTube search per row, picks a
   * candidate, and POSTs a new YouTube playlist on apply. Nothing here writes
   * any audio, any Spotify URL, or any CatalogItem.
   */
  const handlePasteTracklistSubmit = useCallback(
    ({
      playlistName,
      parsed,
    }: {
      playlistName: string;
      parsed: { rows: { artist: string; title: string }[]; totalLines: number; truncated: boolean };
    }) => {
      const unresolvedRows = pastedTracklistRowsToUnresolvedRows(parsed.rows);
      if (unresolvedRows.length === 0) {
        setPasteTracklistOpen(false);
        setUrlError("Paste at least one tracklist line.");
        return;
      }
      setUrlError(null);
      setSpotifyBlockedShowPasteCta(false);
      setM3uImportBanner(null);
      const suffix = parsed.truncated
        ? ` (${unresolvedRows.length} of ${parsed.totalLines}, capped at ${PASTED_TRACKLIST_MAX})`
        : ` (${unresolvedRows.length} tracks)`;
      setM3uYoutubeResolveContext({
        playlistId: "",
        playlistName,
        files: [],
        trackDisplayNames: [],
        resolvedSourceOrders: [],
        unresolvedRows,
        mode: "create_youtube_only",
        sourceLabel: `Pasted tracklist${suffix}`,
      });
      setPasteTracklistOpen(false);
      setYoutubeResolveOpen(true);
    },
    [],
  );

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

  /**
   * Stage 6E-A — handle the post-OAuth return. The callback route redirects to
   * `/sources?spotify=<status>`. On `connected` we transparently re-run the
   * import for the URL the user was blocked on (stashed in sessionStorage when
   * the blocked response arrived) so connecting feels like a single action.
   * Other statuses surface a short inline message. The query param is stripped
   * via replaceState so a refresh never re-triggers the retry.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const spotify = params.get("spotify");
    if (!spotify) return;
    params.delete("spotify");
    const cleaned = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(null, "", cleaned);

    if (spotify === "connected") {
      let pending: string | null = null;
      try {
        pending = window.sessionStorage.getItem("sb_spotify_pending_url");
        window.sessionStorage.removeItem("sb_spotify_pending_url");
      } catch {
        pending = null;
      }
      if (pending && pending.trim()) {
        setUrlValue(pending);
        void ingestUrl(pending);
      }
      return;
    }
    if (spotify === "denied") {
      setUrlError("Spotify connection was cancelled. You can paste the tracklist instead.");
      return;
    }
    if (spotify === "not_configured") {
      setUrlError("Spotify Connect is not configured on this server yet.");
      return;
    }
    if (spotify === "state_error" || spotify === "exchange_failed" || spotify === "profile_failed" || spotify === "save_failed") {
      setUrlError("Spotify connection failed. Please try again, or paste the tracklist.");
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    /**
     * Spotify Desktop drops `spotify:album:<id>` / `spotify:playlist:<id>` in `text/uri-list`,
     * and only puts the canonical `https://open.spotify.com/...` link in `text/plain`. Because
     * `text/uri-list` wins above, the bare URI scheme reached `normalizeLocalFilePathInput` and
     * came back `null` — the drop silently no-op'd and (depending on which other handler ran)
     * surfaced as the legacy "Album or playlist links from this service are not supported yet."
     * fallback. Convert the URI scheme to the HTTPS share link here so the rest of the
     * pipeline (classify → preview → modal) is unchanged.
     */
    const spotifyNormalized = normalizeSpotifyShareInput(first);
    if (spotifyNormalized !== first && (spotifyNormalized.startsWith("http://") || spotifyNormalized.startsWith("https://"))) {
      return spotifyNormalized;
    }
    if (first.startsWith("http://") || first.startsWith("https://")) return first;
    return normalizeLocalFilePathInput(first);
  };

  const handleDropUrl = useCallback(
    (url: string) => {
      applyUrlInputValue(url);
      void ingestUrl(url);
    },
    [applyUrlInputValue, ingestUrl]
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

  const handlePlayCatalog = useCallback(
    async (r: CatalogSearchResult) => {
      const genre = r.genres?.[0] || inferGenre(r.title, query);
      let playableUrl = await resolveYouTubePlayableUrlForSearch(r.url);
      if (!getYouTubeVideoId(playableUrl) && getYouTubeVideoId(r.url)) {
        playableUrl = r.url;
      }
      // Ephemeral catalog preview: build UnifiedSource directly from catalog data.
      // No POST /api/playlists, no branch permission check, no DB write.
      // The playback engine resolves the URL directly (no playlist attachment → uses resolved.url).
      const u: UnifiedSource = {
        id: `catalog-preview-${r.id}`,
        title: r.title,
        genre,
        cover: r.thumbnail ?? null,
        type: "youtube",
        url: playableUrl,
        origin: "playlist",
        catalogItemId: r.id,
        ...unifiedFoundationHints("playlist", "youtube", playableUrl),
      };
      console.log("[SyncBiz Verify] catalog-preview play", {
        path: "A_catalog_preview",
        sourceId: u.id,
        catalogItemId: r.id,
        resolvedUrl: playableUrl,
        hasPlaylist: false,
        hasPrivatePlaylistCreate: false,
        branchCheckRequired: false,
      });
      effectivePlaySource(u);
      setQuery("");
      setCatalogResults([]);
      setYoutubeResults([]);
      setRadioResults([]);
      setLocalResults([]);
      setShowResults(false);
    },
    [query, effectivePlaySource]
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
            applyUrlInputValue(text);
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
            ? "border-[#0a84ff]/50 bg-[#0a84ff]/10"
            : "border-white/[0.08] bg-white/[0.035] hover:border-white/[0.14] focus-within:border-white/[0.18]"
        }`}
      >
        {ingestStripBusy ? <div className="sb-library-ingest-wave" aria-hidden /> : null}
        <div className="sb-library-ingest-inner">
          {/* Single compact control row – Add centered */}
          <form
          noValidate
          onSubmit={handleUrlSubmit}
          className="flex flex-nowrap items-center gap-2 px-2.5 py-1"
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
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6e6e73]">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </span>
            <input
              type="text"
              autoComplete="off"
              value={urlValue}
              onChange={(e) => {
                applyUrlInputValue(e.target.value);
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

          {/* Hairline divider between the two halves of the bar */}
          <span className="h-6 w-px shrink-0 bg-white/[0.08]" aria-hidden />

          {/* Search Library / YouTube + Mic */}
          <div className="relative flex min-w-0 flex-1 items-center gap-1">
          <span className="pl-3 text-[#6e6e73]">
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
            className={`${controlHeight} flex-1 bg-transparent py-2 pr-2 text-sm text-[#f5f5f7] placeholder:text-[#6e6e73] focus:outline-none`}
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
                setCatalogResults([]);
                setShowResults(false);
                inputRef.current?.focus();
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6e6e73] transition-colors hover:bg-white/[0.08] hover:text-white"
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
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                listening
                  ? "bg-[#0a84ff]/15 text-[#409cff]"
                  : "text-[#6e6e73] hover:bg-white/[0.08] hover:text-white"
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
          {onAiPlaylistFromSearchPrompt ? (
            <button
              type="button"
              disabled={aiPlaylistBusy || urlIngesting || !hasQuery || !query.trim()}
              onClick={(e) => {
                e.preventDefault();
                const q = query.trim();
                if (!onAiPlaylistFromSearchPrompt || q.length < 2) return;
                void (async () => {
                  try {
                    setAiPlaylistBusy(true);
                    await onAiPlaylistFromSearchPrompt(q);
                  } finally {
                    setAiPlaylistBusy(false);
                  }
                })();
              }}
              title="Build AI playlist from SyncBiz catalog using this search prompt"
              className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold leading-none transition-colors ${
                aiPlaylistBusy
                  ? "border border-white/[0.08] text-[#6e6e73]"
                  : "border border-white/[0.1] bg-white/[0.05] text-[#a1a1a6] hover:bg-white/[0.09] hover:text-white"
              } disabled:pointer-events-none disabled:opacity-40`}
            >
              {aiPlaylistBusy ? "Building…" : "Build AI Playlist"}
            </button>
          ) : null}
          </div>
        </form>
        </div>
      </div>

      {urlIngestPhase ? (
        <p className="mt-1.5 text-sm font-medium text-cyan-300/95" role="status" aria-live="polite">
          {urlIngestPhase}
        </p>
      ) : null}
      {urlError ? (
        spotifyBlockedShowPasteCta ? (
          /**
           * Spotify-blocked variant — Spotify returned the playlist metadata (name + owner)
           * but blocked the `/tracks` endpoint with HTTP 403 even when the playlist is marked
           * `public: true`. Confirmed against the live API: this is a Spotify ACL gate, not
           * a code bug, and there is no non-OAuth read path. Keep the blocked message verbatim
           * but lift the Paste tracklist CTA out of the small inline amber row into a full
           * bordered panel so the operator's recovery path is impossible to miss.
           */
          <div
            className="mt-1.5 rounded-lg border border-rose-500/35 bg-rose-500/[0.07] px-3 py-2.5 text-sm leading-relaxed text-rose-50/95"
            role="status"
            aria-live="polite"
          >
            <p className="min-w-0">
              <span className="font-semibold">Spotify blocked this playlist.</span>{" "}
              {urlError}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-rose-100/75">
              {spotifyConnectAvailable
                ? spotifyNeedsReauth
                  ? "Your Spotify connection expired. Reconnect to read this playlist, or paste the tracklist (one track per line)."
                  : "Connect your Spotify account to read private/blocked playlists, or paste the tracklist (one track per line)."
                : "Paste the tracklist (one track per line) and we’ll build a YouTube playlist from it."}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {spotifyConnectAvailable ? (
                <button
                  type="button"
                  onClick={() => {
                    /**
                     * Stage 6E-A — pending URL was already stashed in sessionStorage when
                     * the blocked response arrived; full-page nav to the OAuth start route
                     * (cannot be fetch()'d — it 302s cross-origin to accounts.spotify.com).
                     */
                    if (typeof window !== "undefined") {
                      window.location.href = "/api/auth/spotify/start";
                    }
                  }}
                  disabled={urlIngesting || externalYtSaveBusy}
                  className="rounded-lg bg-gradient-to-b from-[#1ed760] to-[#1db954] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)] transition hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
                >
                  {spotifyNeedsReauth ? "Reconnect Spotify" : "Connect Spotify"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setUrlError(null);
                  setSpotifyBlockedShowPasteCta(false);
                  setM3uImportBanner(null);
                  setPasteTracklistOpen(true);
                }}
                disabled={urlIngesting || externalYtSaveBusy}
                className={
                  spotifyConnectAvailable
                    ? "rounded-lg border border-[#1ed760]/45 bg-[#1ed760]/[0.06] px-4 py-2 text-sm font-semibold text-emerald-50/95 transition hover:bg-[#1ed760]/[0.12] disabled:opacity-40"
                    : "rounded-lg bg-gradient-to-b from-[#1ed760] to-[#1db954] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)] transition hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
                }
              >
                Paste tracklist
              </button>
              <button
                type="button"
                onClick={() => {
                  setUrlError(null);
                  setSpotifyBlockedShowPasteCta(false);
                  setSpotifyConnectAvailable(false);
                  setSpotifyNeedsReauth(false);
                }}
                className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/90 hover:bg-white/10"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-xs text-amber-400">{urlError}</p>
          </div>
        )
      ) : null}
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
      {spotifyAutoBuildSummary ? (
        <div
          className={`mt-1.5 rounded-lg border px-3 py-2.5 text-sm leading-relaxed ${
            spotifyAutoBuildSummary.resolvedCount === 0
              ? "border-rose-500/35 bg-rose-500/[0.07] text-rose-50/95"
              : "border-[#1ed760]/35 bg-[#1ed760]/[0.07] text-emerald-50/95"
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 flex-1">
              {spotifyAutoBuildSummary.resolvedCount === 0 ? (
                <>
                  <span className="font-semibold">No YouTube matches found.</span>{" "}
                  0/{spotifyAutoBuildSummary.totalCount} tracks added.
                  <span className="mt-1 block font-medium text-white/95">
                    “{spotifyAutoBuildSummary.playlistName}” — {spotifyAutoBuildSummary.sourceLabel}
                  </span>
                  <span className="mt-1 block font-mono text-[11px] leading-snug text-rose-100/75">
                    Review the missing tracks to pick YouTube matches manually.
                  </span>
                </>
              ) : (
                <>
                  <span className="font-semibold">Created playlist:</span>{" "}
                  {spotifyAutoBuildSummary.resolvedCount}/{spotifyAutoBuildSummary.totalCount} tracks added
                  <span className="mt-1 block font-medium text-white/95">
                    “{spotifyAutoBuildSummary.playlistName}” — {spotifyAutoBuildSummary.sourceLabel}
                  </span>
                  {spotifyAutoBuildSummary.missing.length > 0 ? (
                    <span className="mt-1 block font-mono text-[11px] leading-snug text-emerald-100/75">
                      {spotifyAutoBuildSummary.missing.length} track
                      {spotifyAutoBuildSummary.missing.length === 1 ? "" : "s"} skipped — no confident YouTube match.
                    </span>
                  ) : null}
                </>
              )}
            </p>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {spotifyAutoBuildSummary.missing.length > 0 ? (
                <button
                  type="button"
                  disabled={urlIngesting}
                  onClick={handleReviewMissingAutoBuildTracks}
                  className="rounded-lg bg-gradient-to-b from-[#1ed760] to-[#1db954] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)] transition hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
                >
                  Review missing tracks
                </button>
              ) : null}
              <button
                type="button"
                className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/90 hover:bg-white/10"
                onClick={() => setSpotifyAutoBuildSummary(null)}
              >
                Dismiss
              </button>
            </div>
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
      {pasteTracklistOpen ? (
        <PlainTracklistPasteModal
          defaultPlaylistName="Pasted tracklist"
          onCancel={() => setPasteTracklistOpen(false)}
          onSubmit={handlePasteTracklistSubmit}
        />
      ) : null}

      {/* Search results dropdown */}
      {showResults && hasQuery && (
        <div className="absolute left-0 right-0 top-full z-50 max-h-[64vh] overflow-y-auto rounded-b-2xl border border-t-0 border-white/[0.08] bg-[#0d0d11] shadow-[0_16px_48px_rgba(0,0,0,0.6)]">
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
                <div className="border-b border-white/[0.05] p-2.5">
                  <p className={RESULT_SECTION_HEAD}>My Music Library</p>
                  <div className="space-y-0.5">
                    {musicBankLocalResults.map((source) => (
                      <div key={source.id} className={RESULT_ROW}>
                        <div className={RESULT_THUMB}>
                          {source.cover ? (
                            <img src={source.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <TrackMediaPlaceholder chip="LOCAL" className="h-full w-full" showCornerBadge={false} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2">
                            <span className={RESULT_TITLE}>{source.title}</span>
                            <ResultPlatformLogo kind="local" />
                          </p>
                          {source.genre && <p className={RESULT_META}>{source.genre}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
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
                            className={RESULT_PLAY_BTN}
                            title={t.play}
                            aria-label={t.play}
                          >
                            <ResultPlayIcon />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasLocal && (
                <div className="border-b border-white/[0.05] p-2.5">
                  <p className={RESULT_SECTION_HEAD}>{t.localResults}</p>
                  <div className="space-y-0.5">
                    {localResults.map((source) => {
                      const libChip = inferTrackSourceChip(source);
                      const logoKind =
                        source.type === "youtube" ? ("youtube" as const)
                        : source.origin === "radio" ? ("radio" as const)
                        : libChip === "LOCAL" ? ("local" as const)
                        : null;
                      return (
                      <div key={source.id} className={RESULT_ROW}>
                        <div className={RESULT_THUMB}>
                          {source.cover ? (
                            <img src={source.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <TrackMediaPlaceholder chip={libChip} className="h-full w-full" showCornerBadge={false} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2">
                            <span className={RESULT_TITLE}>{source.title}</span>
                            <ResultPlatformLogo kind={logoKind} />
                          </p>
                          {source.genre && <p className={RESULT_META}>{source.genre}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => effectivePlaySource(source)}
                            className={RESULT_PLAY_BTN}
                            title={t.play}
                            aria-label={t.play}
                          >
                            <ResultPlayIcon />
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push("/sources")}
                            className={RESULT_GHOST_BTN}
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
              {hasCatalog && (
                <div className="border-b border-white/[0.05] p-2.5">
                  <p className={RESULT_SECTION_HEAD}>{t.catalogResults ?? "From catalog"}</p>
                  <div className="space-y-0.5">
                    {catalogResults.map((r) => (
                      <div key={r.id} className={RESULT_ROW}>
                        <div className={RESULT_THUMB}>
                          {r.thumbnail ? (
                            <img src={r.thumbnail} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <TrackMediaPlaceholder chip="YT" className="h-full w-full" showCornerBadge={false} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2">
                            <span className={RESULT_TITLE}>{r.title}</span>
                            <ResultPlatformLogo kind="youtube" />
                          </p>
                          {r.genres?.length > 0 ? (
                            <p className={RESULT_META}>{r.genres.slice(0, 3).join(" · ")}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handlePlayCatalog(r)}
                            className={RESULT_PLAY_BTN}
                            title={t.playNow}
                            aria-label={t.playNow}
                          >
                            <ResultPlayIcon />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasRadio && (
                <div className="p-2.5">
                  <p className={RESULT_SECTION_HEAD}>{t.radioResults ?? "Radio stations"}</p>
                  <div className="space-y-0.5">
                    {radioResults.map((r, i) => (
                      <div key={i} className={RESULT_ROW}>
                        <div className={RESULT_THUMB}>
                          {r.cover ? (
                            <img src={r.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <TrackMediaPlaceholder chip="RADIO" className="h-full w-full" showCornerBadge={false} />
                          )}
                          <span className="absolute bottom-1 right-1 rounded bg-rose-500/90 px-1 py-[1px] text-[8px] font-semibold uppercase tracking-wide text-white">
                            {t.live ?? "LIVE"}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2">
                            <span className={RESULT_TITLE}>{r.title}</span>
                            <ResultPlatformLogo kind="radio" />
                          </p>
                          <p className={RESULT_META}>
                            {r.genre && r.genre !== "Radio" && r.genre !== tx.defaultGenreRadioShort
                              ? r.genre
                              : tx.defaultGenreRadioShort}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleAddRadio(r)}
                            className={RESULT_GHOST_BTN}
                          >
                            {t.addToRadio ?? "Add to Radio"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePlayRadio(r)}
                            className={RESULT_PLAY_BTN}
                            title={t.playNow}
                            aria-label={t.playNow}
                          >
                            <ResultPlayIcon />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {hasYoutube && (
                <div className="p-2.5">
                  <p className={RESULT_SECTION_HEAD}>{t.youtubeResults}</p>
                  <div className="space-y-0.5">
                    {youtubeResults.map((r, i) => (
                      <div key={i} className={RESULT_ROW}>
                        <div className={RESULT_THUMB}>
                          {r.cover ? (
                            <img src={r.cover} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <TrackMediaPlaceholder chip="YT" className="h-full w-full" showCornerBadge={false} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2">
                            <span className={RESULT_TITLE}>{r.title}</span>
                            <ResultPlatformLogo kind="youtube" />
                          </p>
                          <p className={RESULT_META}>
                            {(() => {
                              const g = inferGenre(r.title, query);
                              const parts: string[] = [];
                              if (g && g !== "Mixed" && g !== tx.defaultGenreMixed) parts.push(g);
                              if (r.durationSeconds != null && r.durationSeconds > 0) parts.push(formatDuration(r.durationSeconds));
                              if (r.viewCount != null) parts.push(`${formatViewCount(r.viewCount)} ${t.views ?? "views"}`);
                              return parts.length > 0 ? parts.join(" · ") : tx.providerYouTube;
                            })()}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleAddYoutube(r)}
                            className={RESULT_GHOST_BTN}
                          >
                            {t.addToLibrary}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handlePlayYoutube(r)}
                            className={RESULT_PLAY_BTN}
                            title={t.playNow}
                            aria-label={t.playNow}
                          >
                            <ResultPlayIcon />
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
