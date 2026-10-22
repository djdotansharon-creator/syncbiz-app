"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PlaylistTrack } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { getPlaylistSessionTracks, usePlayback } from "@/lib/playback-provider";
import { useDevicePlayer } from "@/lib/device-player-context";
import type { SessionTrackMirror } from "@/lib/remote-control/types";
import { urlToUnifiedSource } from "@/lib/remote-control/url-to-source";
import { isPlayNextSourceId } from "@/lib/play-next";
import { resolveMyMusicLibraryDropFromDataTransfer } from "@/lib/music-library-drag";
import {
  collectElectronFilePathsFromDataTransfer,
  getNativePathForDroppedFile,
  isLocalPathLikelyFolderInWebBrowser,
  normalizeLocalFilePathInput,
} from "@/lib/local-audio-path";
import { isValidLocalFilePlaybackPath, isValidPlaybackUrl } from "@/lib/url-validation";
import { effectivePlaybackPlaylistAttachment, derivePlaylistTrackCoverArt } from "@/lib/playlist-utils";
import type { UnifiedSource } from "@/lib/source-types";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { useSongAccent } from "@/lib/song-accent";
import { useDeckQueueCollapsed, writeDeckQueueCollapsed } from "@/lib/deck-queue-collapse";
import { SuggestMetadataButton } from "@/components/suggest-metadata-button";
import { CommunityFeedbackSummary } from "@/components/community-feedback-summary";
import { QueueJinglesPane } from "@/components/jingles-control/queue-jingles-pane";
import { setJinglesOpenTab } from "@/components/jingles-control/open-tab";
import { useCenterModule } from "@/lib/center-module-context";
import { displayPlaybackState } from "@/lib/url-transition-intent";
import { useTr } from "@/lib/i18n/use-tr";

type TrackExtra = PlaylistTrack & { durationSeconds?: number; genre?: string; artist?: string };

function mirrorTracksToPlaylistTracks(mirrors: SessionTrackMirror[]): PlaylistTrack[] {
  return mirrors.map((m) => ({
    id: m.id,
    name: m.title,
    title: m.title,
    cover: m.cover ?? undefined,
    url: m.url ?? "",
    type: "stream-url" as const,
    durationSeconds: m.durationSeconds,
  }));
}

/** Thumbnail/CDN URLs — not playable as "Play Next" targets. */
function isImageLikeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return /\.(jpe?g|png|webp|gif|avif|svg|bmp|ico)(\?|#|$)/i.test(u.pathname) || /[/.]ytimg\.com\//i.test(u.hostname);
  } catch {
    return false;
  }
}

function isImageLikeFilePath(path: string): boolean {
  return /\.(jpe?g|png|webp|gif|avif|svg|bmp|ico)(\?|$)/i.test(path.trim());
}

function isAcceptablePlayNextUrl(url: string): boolean {
  return isValidPlaybackUrl(url) && !isImageLikeHttpUrl(url);
}

/** Prefer real page / stream URLs over CDN thumbs. Lower = better. */
function playNextUrlRank(url: string): number {
  const u = url.toLowerCase();
  if (u.includes("youtube.com/watch") || u.includes("youtu.be/")) return 0;
  if (u.includes("soundcloud.com/")) return 1;
  if (u.includes("spotify.com/")) return 2;
  if (/^https?:\/\//.test(u)) return 5;
  return 10;
}

function collectStringsFromHtml(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\]]+/gi)) {
    const t = m[0]?.replace(/[),.]+$/g, "") ?? "";
    if (t) out.push(t);
  }
  return out;
}

function collectHrefsFromHtml(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\b(?:href|data-url|data-href)\s*=\s*["']([^"']+)["']/gi)) {
    const t = m[1]?.trim();
    if (t && t.startsWith("http")) out.push(t);
  }
  return out;
}

function recoverYouTubeWatchUrlFromImageUrls(imageUrls: string[]): string | null {
  for (const u of imageUrls) {
    const m = /[/.]ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,})\//i.exec(u);
    if (m?.[1]) return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  return null;
}

/**
 * Convert a `PlaylistTrack` row into a UnifiedSource so it survives the trip into the Play
 * Next queue with title + cover intact. We only build something usable if the URL is playable;
 * otherwise the track is unsupported (and contributes to the "no playable items" hint).
 */
function playlistTrackToSource(track: PlaylistTrack): UnifiedSource | null {
  const url = (track.url ?? "").trim();
  if (!url) return null;
  if (isValidLocalFilePlaybackPath(url)) {
    if (isImageLikeFilePath(url)) return null;
  } else if (!isAcceptablePlayNextUrl(url)) {
    return null;
  }
  // Carry per-track duration onto the cloned UnifiedSource so the Live Queue NEXT block + the
  // header TOTAL addendum can show real numbers when a saved playlist is dropped in. Without
  // this, every dropped track would show "-" until a slow async enrichment caught up.
  const trackExtra = track as PlaylistTrack & { durationSeconds?: number };
  const durationSeconds =
    typeof trackExtra.durationSeconds === "number" && trackExtra.durationSeconds >= 0
      ? trackExtra.durationSeconds
      : undefined;
  return {
    id: `playlist-track-${track.id}`,
    title: track.name?.trim() || track.title?.trim() || url,
    genre: "Mixed",
    cover: track.cover ?? null,
    type: track.type as UnifiedSource["type"],
    url,
    origin: "source",
    ...(durationSeconds != null ? { durationSeconds } : {}),
  };
}

/**
 * Extract `UnifiedSource[]` from SyncBiz library drag payloads. Without this, dropping a tile
 * onto the Play Next pad yields nothing because the generic file/uri-list/text/html
 * extractors find no payload of their own. We preserve title + cover so the player UI shows
 * the original metadata (vs deriving "watch" from `youtube.com/watch?v=...`).
 *
 * Order of preference: full queue JSON -> single-source JSON. We do NOT consult queue/source
 * IDs; resolving them would require an async fetch which doesn't fit the synchronous drop
 * contract. Producers (`components/sources-manager.tsx`) always set the JSON payloads.
 */
function extractPlayNextItemsFromSyncbizDrag(dt: DataTransfer): {
  sources: UnifiedSource[];
  unsupported: number;
} {
  const sources: UnifiedSource[] = [];
  let unsupported = 0;

  const isPlayableUrl = (url: string): boolean => {
    if (!url) return false;
    if (isValidLocalFilePlaybackPath(url)) return !isImageLikeFilePath(url);
    return isAcceptablePlayNextUrl(url);
  };

  const ingestSource = (s: UnifiedSource | null | undefined) => {
    if (!s) return;
    if (s.origin === "playlist" && s.playlist) {
      const tracks = getPlaylistTracks(s.playlist);
      let added = 0;
      for (const t of tracks) {
        const cloned = playlistTrackToSource(t);
        if (cloned) {
          sources.push(cloned);
          added++;
        }
      }
      if (added === 0) unsupported++;
      return;
    }
    const url = (s.url ?? "").trim();
    if (!isPlayableUrl(url)) {
      unsupported++;
      return;
    }
    sources.push(s);
  };

  const queueJson = dt.getData("application/syncbiz-queue-sources");
  if (queueJson) {
    try {
      const arr = JSON.parse(queueJson) as UnifiedSource[];
      if (Array.isArray(arr)) {
        for (const s of arr) ingestSource(s);
        return { sources: dedupeSources(sources), unsupported };
      }
    } catch {
      /* fall through */
    }
  }

  const singleJson = dt.getData("application/syncbiz-source-json");
  if (singleJson) {
    try {
      ingestSource(JSON.parse(singleJson) as UnifiedSource);
      return { sources: dedupeSources(sources), unsupported };
    } catch {
      /* fall through */
    }
  }

  return { sources, unsupported };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function dedupeSources(arr: UnifiedSource[]): UnifiedSource[] {
  const seen = new Set<string>();
  const out: UnifiedSource[] = [];
  for (const s of arr) {
    const key = `${s.url}|${s.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Prefer `text/uri-list`, `text/html` (anchor hrefs), `text/plain`, then legacy Moz payload.
 * Filter out image/thumbnail URLs so YouTube drags resolve to the watch URL, not hqdefault.jpg.
 */
function extractPlayNextUrlsFromDataTransfer(dt: DataTransfer): {
  urls: string[];
  sawImageOnly: boolean;
} {
  const candidates: string[] = [];
  const imageOnly: string[] = [];
  const htmlExtracted: string[] = [];

  const consider = (raw: string) => {
    const t = raw.trim();
    if (!t.startsWith("http")) return;
    if (isImageLikeHttpUrl(t)) {
      imageOnly.push(t);
      return;
    }
    if (isValidPlaybackUrl(t)) candidates.push(t);
  };

  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      const L = line.trim();
      if (!L || L.startsWith("#")) continue;
      const first = L.split(/\s+/)[0] ?? L;
      consider(first);
    }
  }

  const html = dt.getData("text/html");
  if (html) {
    for (const s of collectHrefsFromHtml(html)) {
      htmlExtracted.push(s);
      consider(s);
    }
    for (const s of collectStringsFromHtml(html)) {
      if (!htmlExtracted.includes(s)) {
        htmlExtracted.push(s);
        consider(s);
      }
    }
  }

  const plain = dt.getData("text/plain");
  if (plain) {
    for (const line of plain.split(/\r?\n/)) {
      for (const token of line.split(/\s+/)) {
        if (token.startsWith("http")) consider(token.replace(/[),.;]+$/g, ""));
      }
    }
  }

  const moz = dt.getData("text/x-moz-url");
  if (moz) {
    const first = moz.split("\n")[0]?.trim();
    if (first) consider(first);
  }

  let recovered: string | null = null;
  if (candidates.length === 0 && imageOnly.length > 0) {
    recovered = recoverYouTubeWatchUrlFromImageUrls(imageOnly);
    if (recovered && isValidPlaybackUrl(recovered) && !isImageLikeHttpUrl(recovered)) {
      candidates.push(recovered);
    }
  }

  const uniq = [...new Set(candidates)].filter(isAcceptablePlayNextUrl);
  uniq.sort((a, b) => playNextUrlRank(a) - playNextUrlRank(b));
  const sawImageOnly = uniq.length === 0 && imageOnly.length > 0;
  return { urls: uniq, sawImageOnly };
}

function extractUrlsFromClipboardText(text: string): string[] {
  const raw: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const token of line.split(/\s+/)) {
      const t = token.replace(/[),.;]+$/g, "").trim();
      if (t.startsWith("http") && isAcceptablePlayNextUrl(t)) raw.push(t);
    }
  }
  const uniq = [...new Set(raw)];
  uniq.sort((a, b) => playNextUrlRank(a) - playNextUrlRank(b));
  return uniq;
}


function formatClockTotal(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Operator Live Queue: session list + in-memory Play Next (local + URLs; does not change saved playlists). */
export function LiveQueuePanel() {
  const tt = useTr();
  /* Collapsed = covers-only mosaic; the deck grid reacts via :has(.sb-queue-collapsed). Display-only. */
  const collapsed = useDeckQueueCollapsed();
  const deviceCtx = useDevicePlayer();
  /* 2026-10-18 (owner): categories next to QUEUE — "Queue" and "Jingles" (more can follow); a bar glides under the active one. */
  const { setActive: setCenterModule } = useCenterModule();
  const [queueTab, setQueueTab] = useState<"queue" | "jingles">("queue");
  const tabsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = tabsRef.current;
    if (!root) return;
    const place = () => {
      const el = root.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!el) return;
      root.style.setProperty("--bar-x", `${el.offsetLeft}px`);
      root.style.setProperty("--bar-w", `${el.offsetWidth}px`);
      root.dataset.ready = "1";
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    return () => ro.disconnect();
  }, [queueTab]);
  const isControlMirror = Boolean(
    deviceCtx?.isBranchConnected &&
      deviceCtx.deviceMode === "CONTROL" &&
      !deviceCtx.isMobileLocalPlayback,
  );
  // P0 Gate 1f: the queue shows the AUDIBLE item as now playing while a new one loads (held state); the item being
  // loaded is a "Loading…" row (same session) or strip (another playlist) — never presented as playing.
  const masterStateLive = deviceCtx?.masterState;
  const heldForQueue = deviceCtx?.urlTransitionHeldState ?? null;
  const transitionForQueue = deviceCtx?.urlTransition ?? null;
  const queueDisplay = useMemo(
    () => displayPlaybackState(masterStateLive, heldForQueue, transitionForQueue),
    [masterStateLive, heldForQueue, transitionForQueue],
  );
  const masterState = queueDisplay.shown;
  const {
    currentSource,
    currentPlaylist,
    currentTrackIndex,
    currentTrack,
    playNextQueue,
    playNextBaseline,
    addPlayNextFromPaths,
    addPlayNextFromUrls,
    addPlayNextSources,
    removePlayNextItem,
    reorderPlayNextItem,
    reorderSessionTrack,
    playSource,
    shuffle,
  } = usePlayback();
  const [overDrop, setOverDrop] = useState(false);
  const [padHover, setPadHover] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPlayNextLenRef = useRef(0);
  const nextBlockRef = useRef<HTMLDivElement | null>(null);
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  /**
   * Drop-event dedupe: the window-level capture-phase listener fires BEFORE React's
   * bubble-phase drop handler, and `e.stopPropagation()` in React doesn't undo work the
   * window listener already did. Both paths share the same native `DataTransfer` instance,
   * so a `WeakSet<DataTransfer>` lets the second caller bail out cleanly. Ref so it survives
   * re-renders without re-allocating per render.
   */
  const processedDtRef = useRef<WeakSet<DataTransfer>>(new WeakSet());

  const showHint = useCallback((msg: string) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setDropHint(msg);
    hintTimer.current = setTimeout(() => {
      setDropHint(null);
      hintTimer.current = null;
    }, 5200);
  }, []);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  /**
   * Core ingest: called from React handlers AND from the window-level fallback. Accepts a raw
   * `DataTransfer` so it can be invoked outside React's synthetic-event flow when a library
   * tile drag bypasses the panel's React handlers (e.g. drop landing on a non-drop sibling).
   * Uses `processedDtRef` to avoid double-adding when both the window capture listener and
   * React drop handler fire for the same native event.
   */
  const ingestDataTransfer = useCallback(
    async (dt: DataTransfer | null, sourcePath: string): Promise<boolean> => {
      if (!dt) return false;
      if (processedDtRef.current.has(dt)) {
        console.debug("[SyncBiz:play-next-skip-dup]", { sourcePath });
        return true;
      }
      processedDtRef.current.add(dt);

      const localLibrary = await resolveMyMusicLibraryDropFromDataTransfer(dt);
      if (localLibrary.length > 0) {
        addPlayNextSources(localLibrary);
        return true;
      }

      const fromSyncbiz = extractPlayNextItemsFromSyncbizDrag(dt);
      if (fromSyncbiz.sources.length > 0) {
        console.debug("[SyncBiz:play-next-syncbiz-drag]", {
          sourcePath,
          count: fromSyncbiz.sources.length,
          firstTitles: fromSyncbiz.sources.slice(0, 4).map((s) => s.title),
          unsupported: fromSyncbiz.unsupported,
        });
        // Route to the MASTER on a CONTROL device: queueNextOrSend → QUEUE_NEXT → the MASTER's OWN
        // playNextQueue (which its next() consumes). On a MASTER it stays local. This is what makes
        // "Drop Next" from a CONTROL actually change what the MASTER plays next.
        const queueNext = deviceCtx?.queueNextOrSend;
        if (queueNext) fromSyncbiz.sources.forEach((s) => queueNext(s));
        else addPlayNextSources(fromSyncbiz.sources);
        return true;
      }

      const fromCollect = collectElectronFilePathsFromDataTransfer(dt);
      const paths: string[] = [];
      let hadImageFiles = false;
      for (const raw of fromCollect) {
        const p = normalizeLocalFilePathInput(raw) ?? raw.trim();
        if (!p || !isValidLocalFilePlaybackPath(p) || isLocalPathLikelyFolderInWebBrowser(p)) continue;
        if (isImageLikeFilePath(p)) {
          hadImageFiles = true;
          continue;
        }
        paths.push(p);
      }
      const { urls, sawImageOnly } = extractPlayNextUrlsFromDataTransfer(dt);
      console.debug("[SyncBiz:play-next-drop]", {
        sourcePath,
        types: [...dt.types],
        filesLen: dt.files.length,
        nativeSample: typeof File !== "undefined" && dt.files[0] ? getNativePathForDroppedFile(dt.files[0]!) : null,
        paths,
        urls,
      });
      const dedupedPaths = dedupe(paths);
      // Local files stay local — a CONTROL can't hand its own filesystem paths to a remote MASTER.
      if (dedupedPaths.length > 0) addPlayNextFromPaths(dedupedPaths);
      if (urls.length > 0) {
        // Remote URLs (YouTube/http) route to the MASTER on a CONTROL so ITS Play-Next queue gets them.
        const queueNext = deviceCtx?.queueNextOrSend;
        if (queueNext && isControlMirror) for (const u of urls) queueNext(urlToUnifiedSource(u));
        else addPlayNextFromUrls(urls);
      }
      if (dedupedPaths.length === 0 && urls.length === 0) {
        if (sawImageOnly || hadImageFiles) {
          showHint("That's an image. Drop the page link (e.g. youtube.com/watch...), not a .jpg.");
        } else if (dt.files.length > 0 && typeof window !== "undefined" && !window.syncbizDesktop?.getPathForFile) {
          showHint("Local files need the desktop app. Use a URL here, or drag the file in Desktop mode.");
        } else if (fromSyncbiz.unsupported > 0) {
          showHint("That library item has no playable URL yet.");
        } else {
          showHint("Nothing playable in that drop. Try a video/page URL or an audio file.");
        }
        return false;
      }
      return true;
    },
    [addPlayNextFromPaths, addPlayNextFromUrls, addPlayNextSources, showHint, deviceCtx?.queueNextOrSend, isControlMirror],
  );

  const ingestDrop = useCallback(
    (e: React.DragEvent, sourcePath: "pad" | "panel" = "pad") => {
      e.preventDefault();
      e.stopPropagation();
      setOverDrop(false);
      void ingestDataTransfer(e.dataTransfer, sourcePath);
    },
    [ingestDataTransfer],
  );

  /**
   * Window-level capture-phase fallback. When a library tile is dragged onto the panel, the
   * React drop handler sometimes does NOT fire because the user releases over a transparent
   * sibling that didn't preventDefault on dragover. Catching the native `drop` here — only
   * when the target is INSIDE this panel root — guarantees the enqueue runs in those cases.
   *
   * Critical: do NOT trigger on drops outside the panel even when SyncBiz MIME types are
   * present, otherwise dropping a library tile onto the player area would also enqueue
   * Play Next AND swallow the player-drop side effect (preventDefault wins). Dedupe with
   * `processedDtRef` keeps the React handlers idempotent when both fire for the same drop.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isInsidePanel = (target: EventTarget | null): boolean => {
      const root = panelRootRef.current;
      return !!(root && target instanceof Node && root.contains(target));
    };
    const onWinDrop = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      if (!isInsidePanel(e.target)) return;
      e.preventDefault();
      void (async () => {
        const consumed = await ingestDataTransfer(dt, "window");
        const types = [...dt.types];
        const hasSyncbiz = types.some((t) => t.startsWith("application/syncbiz-"));
        if (!consumed && hasSyncbiz) {
          showHint("Couldn't read that library item. Try dropping a different track.");
        }
      })();
    };
    const onWinDragOver = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      if (!isInsidePanel(e.target)) return;
      e.preventDefault();
      dt.dropEffect = "copy";
    };
    window.addEventListener("drop", onWinDrop, true);
    window.addEventListener("dragover", onWinDragOver, true);
    return () => {
      window.removeEventListener("drop", onWinDrop, true);
      window.removeEventListener("dragover", onWinDragOver, true);
    };
  }, [ingestDataTransfer, showHint]);

  const sessionForList = useMemo(() => {
    if (isControlMirror && masterState) {
      return {
        currentSource: null,
        currentPlaylist: null,
        highlightIndex: typeof masterState.currentTrackIndex === "number" ? masterState.currentTrackIndex : 0,
      };
    }
    if (isPlayNextSourceId(currentSource?.id) && playNextBaseline) {
      return {
        currentSource: playNextBaseline.currentSource,
        currentPlaylist: playNextBaseline.currentPlaylist,
        highlightIndex: playNextBaseline.currentTrackIndex,
      };
    }
    return {
      currentSource,
      currentPlaylist,
      highlightIndex: currentTrackIndex,
    };
  }, [isControlMirror, masterState, currentSource, currentPlaylist, currentTrackIndex, playNextBaseline]);

  const onPlaylist = useMemo(() => {
    if (isControlMirror) return null;
    const a = sessionForList.currentSource ? effectivePlaybackPlaylistAttachment(sessionForList.currentSource) : null;
    return a ?? sessionForList.currentPlaylist;
  }, [sessionForList.currentSource, sessionForList.currentPlaylist, isControlMirror]);

  const sessionTracks = useMemo(() => {
    if (isControlMirror) {
      // CONTROL mirrors the MASTER: the queue must come from masterState, never local provider state
      // (which is empty on a CONTROL device). Prefer the rich `sessionTracks` (carries url + duration,
      // sent by streamer v1.11.0+ and the desktop MASTER); fall back to `queue` — which EVERY MASTER
      // sends, for every playback kind and every version (older streamer, radio/single-track, Music
      // Bank). Same ordering + indexing as `sessionTracks`, so highlight/next still align. This is why
      // the Live Queue stayed empty in CONTROL when the streamer sent only `queue`.
      if (masterState?.sessionTracks?.length) return mirrorTracksToPlaylistTracks(masterState.sessionTracks);
      if (masterState?.queue?.length) return mirrorTracksToPlaylistTracks(masterState.queue);
      return [];
    }
    const fromProvider = getPlaylistSessionTracks({
      currentSource: sessionForList.currentSource,
      currentPlaylist: sessionForList.currentPlaylist,
    });
    if (fromProvider.length > 0) return fromProvider;
    // Render-only fallback: keep session rows visible when the playlist attachment
    // (same source as the header name) still has tracks but provider reconciliation
    // returned empty for a tick.
    return onPlaylist ? getPlaylistTracks(onPlaylist) : [];
  }, [isControlMirror, masterState?.sessionTracks, masterState?.queue, sessionForList.currentSource, sessionForList.currentPlaylist, onPlaylist]);

  const visiblePlayNextQueue = useMemo(() => {
    if (isControlMirror && masterState?.playNextQueue?.length) {
      return masterState.playNextQueue.map((it) => ({
        id: it.id,
        title: it.title,
        cover: it.cover,
      }));
    }
    return playNextQueue;
  }, [isControlMirror, masterState?.playNextQueue, playNextQueue]);

  // Flash the NEXT section when the queue grows so the enqueue is obvious even if the list is long.
  useEffect(() => {
    const prev = prevPlayNextLenRef.current;
    prevPlayNextLenRef.current = visiblePlayNextQueue.length;
    if (visiblePlayNextQueue.length <= prev) return;
    const node = nextBlockRef.current;
    if (!node) return;
    if (flashTimer.current) clearTimeout(flashTimer.current);
    node.classList.remove("play-next-block-flash");
    void node.offsetWidth;
    node.classList.add("play-next-block-flash");
    flashTimer.current = setTimeout(() => {
      node.classList.remove("play-next-block-flash");
      flashTimer.current = null;
    }, 900);
  }, [visiblePlayNextQueue.length]);

  const plName =
    isControlMirror
      ? (masterState?.sessionTitle?.trim() ||
          masterState?.currentSource?.title?.trim() ||
          tt("Current session"))
      : onPlaylist?.name?.trim() || sessionForList.currentSource?.title?.trim() || tt("Current session");
  const playlistGenre = (onPlaylist?.genre ?? "").trim();

  /**
   * URL -> durationSeconds cache for tracks whose persisted PlaylistTrack lacks a duration.
   * The Live Queue resolves missing durations lazily via /api/playlists/metadata so the per-
   * track Time column and the header TOTAL addendum populate progressively rather than
   * showing "-" forever for older saved playlists. Throttled to 2 concurrent requests below
   * to avoid hammering the yt-dlp resolver.
   */
  const [trackDurationCache, setTrackDurationCache] = useState<Record<string, number>>({});
  const inFlightDurationsRef = useRef<Set<string>>(new Set());
  const failedDurationsRef = useRef<Set<string>>(new Set());

  const getTrackDuration = useCallback(
    (track: PlaylistTrack): number | undefined => {
      const direct = (track as TrackExtra).durationSeconds;
      if (typeof direct === "number" && direct >= 0) return direct;
      const url = (track.url ?? "").trim();
      if (!url) return undefined;
      const cached = trackDurationCache[url];
      return typeof cached === "number" && cached >= 0 ? cached : undefined;
    },
    [trackDurationCache],
  );

  /**
   * Session-only "hide from view" set. Track *original* index because PlaylistTrack ids may
   * collide across rebuilds and we never want to leak this filtering into persistence. The
   * scope is keyed by sessionForList.currentSource?.id so loading a different playlist (or
   * dropping/leaving Play Next mode that swaps the displayed session) auto-clears the hide
   * list — operators expect a fresh session view.
   *
   * NOTE: This is intentionally view-only. The provider's session model and saved playlist
   * tracks are NEVER mutated by this set; computeSessionNextTrackIndex still walks the full
   * underlying track array, so transport (next/prev) keeps working over hidden rows. That's
   * acceptable for this iteration — operators using "hide" already know the row is gone from
   * their visible plan; auto-skipping would be a behaviour change they explicitly deferred.
   */
  const sessionScopeId = isControlMirror
    ? (masterState?.currentSource?.id ?? masterState?.sessionPlaylistId ?? null)
    : (sessionForList.currentSource?.id ?? null);
  const [removedSessionTrackIndexes, setRemovedSessionTrackIndexes] = useState<Set<number>>(
    () => new Set(),
  );
  const removedScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (removedScopeRef.current === sessionScopeId) return;
    removedScopeRef.current = sessionScopeId;
    setRemovedSessionTrackIndexes((prev) => (prev.size === 0 ? prev : new Set()));
  }, [sessionScopeId]);

  const displayedSessionTracks = useMemo(() => {
    const rows = sessionTracks
      .map((track, originalIndex) => ({ track, originalIndex }))
      .filter(({ originalIndex }) => !removedSessionTrackIndexes.has(originalIndex));
    /* The playing song always leads the stack: rotate the DISPLAY so the current
       row is first and the upcoming order follows it. Pure presentation — every
       row keeps its originalIndex, so click-to-play/highlight logic is untouched. */
    const cur = rows.findIndex(({ originalIndex }) => originalIndex === sessionForList.highlightIndex);
    if (cur > 0) return [...rows.slice(cur), ...rows.slice(0, cur)];
    return rows;
  }, [sessionTracks, removedSessionTrackIndexes, sessionForList.highlightIndex]);

  /*
   * Lazy duration resolver. Runs whenever the visible session changes. For every playable URL
   * lacking a duration (after persisted track + local cache), fire GET /api/playlists/metadata
   * with limited concurrency. Successful responses populate `trackDurationCache` which the
   * row + total render reads via `getTrackDuration`.
   *
   * Cache scopes:
   *   trackDurationCache    -> persistent across the panel's lifetime (results survive view
   *                            toggles, switching back to a previously-seen playlist, etc.)
   *   inFlightDurationsRef  -> guards against duplicate concurrent requests for the same URL
   *   failedDurationsRef    -> avoids retrying URLs that already failed to resolve once
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionTracks.length === 0) return;

    const MAX_CONCURRENT = 2;
    let cancelled = false;
    const need: string[] = [];
    const seen = new Set<string>();
    for (const t of sessionTracks) {
      const direct = (t as TrackExtra).durationSeconds;
      if (typeof direct === "number" && direct >= 0) continue;
      const url = (t.url ?? "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      if (trackDurationCache[url] != null) continue;
      if (inFlightDurationsRef.current.has(url)) continue;
      if (failedDurationsRef.current.has(url)) continue;
      // Only resolve URLs we have a chance of getting metadata for. Local file paths won't
      // round-trip through /api/playlists/metadata; we accept "-" for those for now.
      if (!/^https?:\/\//i.test(url)) continue;
      need.push(url);
    }
    if (need.length === 0) return;

    const queue = need.slice();
    let active = 0;

    const tick = (): void => {
      if (cancelled) return;
      while (active < MAX_CONCURRENT && queue.length > 0) {
        const url = queue.shift()!;
        if (inFlightDurationsRef.current.has(url)) continue;
        inFlightDurationsRef.current.add(url);
        active++;
        void (async () => {
          try {
            const res = await fetch(
              `/api/playlists/metadata?url=${encodeURIComponent(url)}`,
              { signal: AbortSignal.timeout(15_000) },
            );
            if (!res.ok) {
              failedDurationsRef.current.add(url);
              return;
            }
            const data = (await res.json()) as { durationSeconds?: number };
            const d = data?.durationSeconds;
            if (typeof d === "number" && d >= 0) {
              if (cancelled) return;
              setTrackDurationCache((prev) => (prev[url] === d ? prev : { ...prev, [url]: d }));
            } else {
              failedDurationsRef.current.add(url);
            }
          } catch {
            failedDurationsRef.current.add(url);
          } finally {
            inFlightDurationsRef.current.delete(url);
            active--;
            if (!cancelled) tick();
          }
        })();
      }
    };
    tick();

    return () => {
      cancelled = true;
    };
  }, [sessionTracks, trackDurationCache]);

  const totalPlaylistSeconds = useMemo(() => {
    // Effective per-track duration = persisted value || lazily-resolved cache value.
    const durs = sessionTracks.map((t) => getTrackDuration(t));
    if (durs.length > 0 && durs.every((d) => typeof d === "number" && d >= 0)) {
      return durs.reduce<number>((a, b) => a + (b as number), 0);
    }
    const plS = (onPlaylist as { durationSeconds?: number } | null)?.durationSeconds;
    if (typeof plS === "number" && plS >= 0) return plS;
    const sumKnown = durs
      .filter((d): d is number => typeof d === "number" && d >= 0)
      .reduce((a, b) => a + b, 0);
    return sumKnown > 0 ? sumKnown : null;
  }, [onPlaylist, sessionTracks, getTrackDuration]);

  // Sum durations of staged Play Next items where we know them (library tile drops carry
  // durationSeconds; URL drops get them after async parse-url enrichment). Surfacing this as a
  // "+M:SS" addendum makes it clear the total grows when the operator queues extras while
  // keeping the saved-session total visually distinct.
  const playNextSeconds = useMemo(() => {
    const known = visiblePlayNextQueue
      .map((it) => (it as UnifiedSource & { durationSeconds?: number }).durationSeconds)
      .filter((d): d is number => typeof d === "number" && d >= 0);
    if (known.length === 0) return null;
    return known.reduce((a, b) => a + b, 0);
  }, [visiblePlayNextQueue]);

  const markNextInOrder = !shuffle && sessionTracks.length > 0;
  const nextLinear = useMemo(() => {
    if (!markNextInOrder) return null;
    if (sessionTracks.length === 1) return 0;
    if (sessionForList.highlightIndex < sessionTracks.length - 1) {
      return sessionForList.highlightIndex + 1;
    }
    return 0;
  }, [markNextInOrder, sessionForList.highlightIndex, sessionTracks.length]);

  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer?.types?.length) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);
  const handlePanelDrop = useCallback(
    (e: React.DragEvent) => {
      ingestDrop(e, "panel");
    },
    [ingestDrop],
  );
  const handlePadDrop = useCallback(
    (e: React.DragEvent) => {
      ingestDrop(e, "pad");
    },
    [ingestDrop],
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const urls = extractUrlsFromClipboardText(text);
      if (urls.length > 0) addPlayNextFromUrls(urls);
      else if (text.trim().startsWith("http") && isImageLikeHttpUrl(text.trim())) {
        showHint("Paste the video or page URL, not an image link.");
      }
    },
    [addPlayNextFromUrls, showHint],
  );

  const playSessionTrack = deviceCtx?.playSourceOrSend ?? playSource;

  // P0 Gate 1f: the pending item — a row of the shown list (same playlist, or nothing audible = the list IS the new
  // session) gets "Loading…" instead of the now-playing bars; another playlist loading over audible music = a strip.
  const qPending = isControlMirror ? queueDisplay.pending : null;
  const pendingRowIndex = qPending && (qPending.sameSession || !heldForQueue) ? qPending.index : null;
  const pendingStrip = qPending && !qPending.sameSession && heldForQueue ? qPending : null;

  /**
   * Queue row jump: re-invokes playSource on the displayed session source at the requested
   * underlying track index. Reuses the existing playback path (no separate "jump" code path),
   * so MPV / embedded / queue handling stay identical to a normal Play.
   *
   * Attaches the reconciled onPlaylist when present so runPlay sees the same leaf rows as the
   * queue list (not a thin source.playlist shell that would clamp every jump to index 0).
   */
  const jumpToSessionTrack = useCallback(
    (originalIndex: number) => {
      if (originalIndex < 0 || originalIndex >= sessionTracks.length) return;

      // P0 Gate 1e: a MAIN-mirrored URL session (station renderer / remote CONTROL) jumps BY INDEX through the session
      // owner. The mirror carries no track URLs, so a reconstructed source could only send an empty / wrong-track
      // URL (title moves, audio does not). LOCAL mirrored sessions keep the existing path.
      const mirrored = masterState?.currentSource;
      if (isControlMirror && deviceCtx?.jumpToSessionIndexOrSend && mirrored?.id && mirrored.sourceType !== "local") {
        deviceCtx.jumpToSessionIndexOrSend(originalIndex, mirrored.id);
        return;
      }

      let src = sessionForList.currentSource;
      if (!src && isControlMirror && masterState?.currentSource?.id && currentSource?.id === masterState.currentSource.id) {
        src = currentSource;
      }
      // CONTROL mirror: the panel nulls its local source, so reconstruct a minimal UnifiedSource that
      // carries the MASTER's current source id + the mirrored tracks. playSourceOrSend routes it as
      // PLAY_SOURCE{trackIndex}; the MASTER matches the id and jumps on its OWN full source (local file
      // paths are stripped on the wire), so remote AND local sessions jump to the clicked track instead
      // of the click being a local no-op.
      if (!src && isControlMirror && masterState?.currentSource?.id) {
        const ms = masterState.currentSource;
        src = {
          id: ms.id,
          title: ms.title ?? masterState.sessionTitle ?? "Session",
          genre: "Mixed",
          cover: ms.cover ?? null,
          type: "youtube",
          url: "",
          origin: "playlist",
          playlist: {
            id: masterState.sessionPlaylistId ?? ms.id,
            name: masterState.sessionTitle ?? ms.title ?? "Session",
            tracks: sessionTracks,
          },
        } as unknown as UnifiedSource;
      }
      if (!src) return;

      const pl = onPlaylist;
      const jumpSource =
        pl && (!src.playlist || src.playlist.id === pl.id) ? { ...src, playlist: pl } : src;

      try {
        playSessionTrack(jumpSource, originalIndex);
      } catch (err) {
        console.warn("[SyncBiz:live-queue-jump] failed", err);
      }
    },
    [
      playSessionTrack,
      deviceCtx,
      sessionForList.currentSource,
      sessionTracks,
      isControlMirror,
      masterState,
      currentSource,
      onPlaylist,
    ],
  );

  const removeSessionRow = useCallback((originalIndex: number) => {
    setRemovedSessionTrackIndexes((prev) => {
      if (prev.has(originalIndex)) return prev;
      const next = new Set(prev);
      next.add(originalIndex);
      return next;
    });
  }, []);

  const removePlayNextRow = useCallback(
    (id: string) => {
      // P0 Drop Next: a CONTROL mirror removes from MAIN's queue (the one actually played)
      if (isControlMirror && deviceCtx?.removeQueueNextOrSend) deviceCtx.removeQueueNextOrSend(id);
      else removePlayNextItem(id);
    },
    [removePlayNextItem, isControlMirror, deviceCtx],
  );

  /* 2026-10-14 (owner): the TOP ROW IS ALWAYS WHAT PLAYS NOW. When the session list cannot show
     it as one of its own rows — a Play Next item is playing, a single track plays with no
     playlist, or the list and the pointer disagree for a tick — the playing track is drawn as a
     detached row (expanded) / tile (collapsed) from the provider's own currentTrack. In that case
     the session's "current" row joins the rows after the divider (it is what comes back next). */
  const nowPlayingDetached = (() => {
    const highlightShown = sessionTracks.length > 0 && displayedSessionTracks.some((x) => x.originalIndex === sessionForList.highlightIndex);
    if (isControlMirror) {
      if (highlightShown) return null;
      const mt = masterState?.currentTrack;
      const msrc = masterState?.currentSource;
      if (!mt && !msrc) return null;
      return { title: mt?.title ?? msrc?.title ?? "Track", thumb: mt?.cover ?? msrc?.cover ?? null, catalogItemId: null as string | null };
    }
    if (highlightShown && !isPlayNextSourceId(currentSource?.id)) return null;
    if (!currentTrack && !currentSource) return null;
    const thumb = derivePlaylistTrackCoverArt({
      cover: currentTrack?.cover ?? currentSource?.cover ?? undefined,
      url: currentTrack?.url ?? currentSource?.url ?? "",
      type: (currentTrack?.type ?? currentSource?.type ?? "youtube") as Parameters<typeof derivePlaylistTrackCoverArt>[0]["type"],
    });
    return { title: currentTrack?.title ?? currentSource?.title ?? "Track", thumb, catalogItemId: currentSource?.catalogItemId ?? null };
  })();
  /* FLIP (2026-10-14, owner: "everything must be smooth"): every cover carries data-flip-key.
     After each render, covers whose box moved or resized glide from the old box to the new one
     (Web Animations, composited) — a clicked song rises out of the list into the top row, a
     reorder settles, and on collapse/expand the squares grow or shrink from where they were.
     Skipped while a drag is in progress and once right after a drop (the ghost already moved). */
  const flipRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const flipSkipOnceRef = useRef(false);
  const settlingRef = useRef(false);
  const flipQuietUntilRef = useRef(0); // collapse/expand are pure CSS transitions — FLIP keeps its hands off meanwhile
  const flipWasQuietRef = useRef(false);
  useLayoutEffect(() => {
    const root = panelRootRef.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>("[data-flip-key]");
    const next = new Map<string, DOMRect>();
    const quietNow = performance.now() < flipQuietUntilRef.current;
    const afterQuiet = !quietNow && flipWasQuietRef.current; // first render after a quiet spell: just re-measure
    flipWasQuietRef.current = quietNow;
    const quiet = !!queueDragRef.current || flipSkipOnceRef.current || settlingRef.current || quietNow || afterQuiet;
    flipSkipOnceRef.current = false;
    const moved = new Map<HTMLElement, { dx: number; dy: number }>(); // rows animated this pass (DOM order: row before its cover)
    els.forEach((el) => {
      const key = el.dataset.flipKey;
      if (!key) return;
      // a glide already in flight continues from where it visually is (no restart, no jump):
      // measure the visual box, drop the old glide, measure the true layout box
      const running = el.getAnimations().filter((a) => a.id === "flip");
      const visual = running.length ? el.getBoundingClientRect() : null;
      running.forEach((a) => a.cancel());
      const r = el.getBoundingClientRect();
      next.set(key, r);
      if (quiet || r.width === 0 || r.height === 0) return;
      const prev = visual ?? flipRectsRef.current.get(key);
      if (!prev || prev.width === 0 || prev.height === 0) return;
      const dx = prev.left - r.left;
      const dy = prev.top - r.top;
      const sx = prev.width / r.width;
      const sy = prev.height / r.height;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
      // a cover whose row already glides by the same offset rides along with it
      const rowAnc = el.parentElement?.closest<HTMLElement>("[data-flip-key]") ?? null;
      const anc = rowAnc ? moved.get(rowAnc) : undefined;
      if (anc && Math.abs(anc.dx - dx) < 0.5 && Math.abs(anc.dy - dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
      moved.set(el, { dx, dy });
      try {
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "none" }],
          { duration: 440, easing: "cubic-bezier(0.22, 1, 0.36, 1)", id: "flip" },
        );
      } catch {
        /* no WAAPI — rows simply appear in place */
      }
    });
    flipRectsRef.current = next;
  });
  /* Long-press → drag to reorder (2026-10-13, owner): hold a row ~320ms, then move it up or
     down inside its group (Play Next items / session tracks). The move is committed through the
     provider (reorderPlayNextItem / reorderSessionTrack) so the real play order follows. The
     playing row never moves. Pointer events (mouse + pen); touch keeps its native scroll. */
  type QueueDrag = {
    group: "pn" | "session"; from: number; to: number; dy: number; stride: number; startY: number;
    /** the lifted row's screen box + content — drawn as a GHOST in a body portal so nothing clips it */
    rect: { left: number; top: number; width: number; height: number }; title: string; thumb: string | null;
  };
  const [queueDrag, setQueueDrag] = useState<QueueDrag | null>(null);
  const queueDragRef = useRef<QueueDrag | null>(null);
  const pressRef = useRef<{ group: "pn" | "session"; pos: number; pointerId: number; x: number; y: number; timer: number } | null>(null);
  const dragElRef = useRef<HTMLLIElement | null>(null); // the row being moved (kept in place, invisible)
  const ghostRef = useRef<HTMLDivElement | null>(null); // the lifted copy that follows the pointer (imperative, no re-render per pixel)
  const beginDrag = (el: HTMLLIElement, group: "pn" | "session", pos: number, pointerId: number, startY: number) => {
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* pointer already gone */
    }
    /* collapsed strip (owner, 2026-10-14: "reorder also when the list is closed"): the lifted copy
       is the 45px cover alone, and the slot stride is measured from the real layout (row + gap). */
    const b = (collapsed ? el.querySelector(".sb-queue-rowline-thumb") ?? el : el).getBoundingClientRect();
    const rowBox = el.getBoundingClientRect();
    const nextBox = (el.nextElementSibling as HTMLElement | null)?.getBoundingClientRect();
    const prevBox = (el.previousElementSibling as HTMLElement | null)?.getBoundingClientRect();
    const stride = nextBox ? nextBox.top - rowBox.top : prevBox ? rowBox.top - prevBox.top : el.offsetHeight + 2;
    const d: QueueDrag = {
      group, from: pos, to: pos, dy: 0, stride: Math.max(1, Math.round(stride)), startY,
      rect: { left: b.left, top: b.top, width: b.width, height: b.height },
      title: el.querySelector(".sb-queue-rowline-title")?.textContent?.trim() ?? "",
      thumb: el.querySelector("img")?.getAttribute("src") ?? null,
    };
    queueDragRef.current = d;
    dragElRef.current = el;
    setQueueDrag(d);
  };
  const suppressRowClickRef = useRef(false);
  const clearPress = () => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };
  const groupCount = (group: "pn" | "session") => (group === "pn" ? visiblePlayNextQueue.length : sessionAfterRows.length);
  const onRowPointerDown = (group: "pn" | "session", pos: number) => (e: React.PointerEvent<HTMLLIElement>) => {
    if (isControlMirror || queueDragRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return; // the X keeps its own click
    clearPress();
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const timer = window.setTimeout(() => {
      if (!pressRef.current) return;
      beginDrag(el, group, pos, pointerId, startY); // held still → lift
    }, 260);
    pressRef.current = { group, pos, pointerId, x: e.clientX, y: e.clientY, timer };
  };
  const onRowPointerMove = (e: React.PointerEvent<HTMLLIElement>) => {
    const d = queueDragRef.current;
    if (d) {
      if (settlingRef.current) return;
      const dy = e.clientY - d.startY;
      const g = ghostRef.current;
      if (g) g.style.transform = `translateY(${dy}px) scale(var(--sb-lift, 1.04))`; // the ghost follows every pointer move
      const to = Math.max(0, Math.min(groupCount(d.group) - 1, d.from + Math.round(dy / d.stride)));
      queueDragRef.current = { ...d, to, dy };
      if (to !== d.to) setQueueDrag({ ...d, to, dy }); // neighbours step aside only when the slot changes
      e.preventDefault();
      return;
    }
    const p = pressRef.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dyp = e.clientY - p.y;
    if (Math.abs(dyp) >= 5 && Math.abs(dyp) >= Math.abs(dx)) {
      // moved up/down while pressed → drag right away, no hold needed
      const el = e.currentTarget;
      const { group, pos, pointerId } = p;
      clearPress();
      beginDrag(el, group, pos, pointerId, p.y);
      return;
    }
    if (Math.abs(dx) > 10) clearPress(); // a sideways gesture is not a drag
  };
  const onRowPointerEnd = (e: React.PointerEvent<HTMLLIElement>) => {
    const d = queueDragRef.current;
    if (d) {
      // the browser fires `click` right after this pointerup — a drop must never play the song
      // (ROOT CAUSE of the "song goes crazy on drop": the suppression used to be set only after
      // the 200ms settle, so the click slipped through and jumped playback to the dragged row)
      suppressRowClickRef.current = true;
      if (settlingRef.current) return; // the ghost is already gliding home
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      const cancelled = e.type === "pointercancel";
      const slotDy = (d.to - d.from) * d.stride;
      const g = ghostRef.current;
      if (g && !cancelled) {
        // glide the ghost into the slot it will take (or back home), then commit
        settlingRef.current = true;
        g.classList.add("is-settling"); // the lifted pill melts away while the row glides home
        g.style.transition = "transform 190ms cubic-bezier(0.22, 1, 0.36, 1)";
        g.style.transform = `translateY(${slotDy}px) scale(1)`;
        window.setTimeout(() => finishDrag(d, false), 200);
        return;
      }
      finishDrag(d, cancelled);
    }
    clearPress();
  };
  const finishDrag = (d: QueueDrag, cancelled: boolean) => {
    settlingRef.current = false;
    {
      if (d.to !== d.from && !cancelled) {
        if (d.group === "pn") {
          reorderPlayNextItem(d.from, d.to);
        } else {
          const rawFrom = sessionAfterRows[d.from]?.originalIndex;
          const rawTarget = sessionAfterRows[d.to]?.originalIndex;
          if (rawFrom !== undefined && rawTarget !== undefined) {
            let to = rawTarget > rawFrom ? rawTarget - 1 : rawTarget; // the target's index once `from` is out
            if (d.to > d.from) to += 1; // moving down lands AFTER the target
            reorderSessionTrack(rawFrom, to);
            setRemovedSessionTrackIndexes((prev) => {
              if (prev.size === 0) return prev;
              const next = new Set<number>();
              for (const h of prev) {
                if (h === rawFrom) next.add(to);
                else if (rawFrom < h && h <= to) next.add(h - 1);
                else if (to <= h && h < rawFrom) next.add(h + 1);
                else next.add(h);
              }
              return next;
            });
          }
        }
      }
      window.setTimeout(() => {
        suppressRowClickRef.current = false;
      }, 50);
      flipSkipOnceRef.current = true; // the ghost already made the move — no second glide
      dragElRef.current = null;
      queueDragRef.current = null;
      setQueueDrag(null);
    }
    clearPress();
  };
  const rowDragPresentation = (group: "pn" | "session", pos: number): { className: string; style: CSSProperties } => {
    const d = queueDrag;
    if (!d || d.group !== group) return { className: "", style: {} };
    if (pos === d.from) return { className: "is-dragging", style: {} };
    if (d.from < d.to && pos > d.from && pos <= d.to) return { className: "is-shifting", style: { transform: `translateY(-${d.stride}px)` } };
    if (d.to < d.from && pos >= d.to && pos < d.from) return { className: "is-shifting", style: { transform: `translateY(${d.stride}px)` } };
    return { className: "is-shifting", style: {} };
  };
  /* 2026-10-13 (owner): "the colour of the song" — the playing row's accent bar and its bars
     animation take the cover's dominant vivid colour (neutral white when the cover is grey). */
  const currentTrackThumb = (() => {
    if (nowPlayingDetached) return nowPlayingDetached.thumb;
    const cur = displayedSessionTracks.find((x) => x.originalIndex === sessionForList.highlightIndex)?.track;
    return cur ? derivePlaylistTrackCoverArt({ cover: cur.cover, url: cur.url, type: cur.type }) : null;
  })();
  const nowAccent = useSongAccent(currentTrackThumb);
  const nowAccentStyle = { "--sb-accent": nowAccent ?? "rgba(255, 255, 255, 0.72)" } as CSSProperties;
  /* Expanded queue (2026-10-13, owner): what comes next is ONE ROW PER TRACK — a small square and
     the name, thinner than the playing row. Play Next items come first (they really play next),
     then the session's upcoming tracks in play order. Display-only. */
  const renderSessionRow = (t: PlaylistTrack, i: number, k: number) => {
    const title = t.name ?? t.title ?? t.url ?? "Track";
    const thumb = derivePlaylistTrackCoverArt({ cover: t.cover, url: t.url, type: t.type });
    const isNext = markNextInOrder && nextLinear !== null && i === nextLinear;
    return (
      <li
        key={`row-${t.id}`}
        data-flip-key={`row:${t.id}`}
        role="button"
        tabIndex={0}
        title={title}
        data-idx={i}
        data-next={isNext ? "true" : undefined}
        onClick={(e) => {
          if (suppressRowClickRef.current || queueDragRef.current) return;
          e.currentTarget.classList.add("is-lifting"); // the song comes out of the list as it starts
          jumpToSessionTrack(i);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jumpToSessionTrack(i);
          }
        }}
        onDragStart={(e) => e.preventDefault()} /* the cover is an <img>: Chromium would start a NATIVE image drag and fire pointercancel — the long-press drag never survived a press on the cover (the only thing there when the strip is collapsed) */
        onPointerDown={onRowPointerDown("session", k - visiblePlayNextQueue.length)}
        onPointerMove={onRowPointerMove}
        onPointerUp={onRowPointerEnd}
        onPointerCancel={onRowPointerEnd}
        className={`sb-queue-rowline ${rowDragPresentation("session", k - visiblePlayNextQueue.length).className}`}
        style={{ animationDelay: `${Math.min(k, 14) * 16}ms`, ...rowDragPresentation("session", k - visiblePlayNextQueue.length).style }}
      >
        <span className="sb-queue-rowline-thumb" data-flip-key={`s:${t.id}`}>
          {thumb ? <HydrationSafeImage src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="sb-queue-rowline-num">{k + 2}</span>}
        </span>
        <span dir="auto" className="sb-queue-rowline-title">{title}</span>
        <button
          type="button"
          aria-label={`Remove "${title}" from this session`}
          title="Remove from this session (the saved playlist is untouched)"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            removeSessionRow(i);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="sb-queue-rowline-remove focus:outline-none"
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </li>
    );
  };
  const renderPlayNextRow = (it: (typeof visiblePlayNextQueue)[number], k: number) => {
    const meta = it as { cover?: string | null; url?: string; type?: Parameters<typeof derivePlaylistTrackCoverArt>[0]["type"] };
    const thumb = derivePlaylistTrackCoverArt({ cover: meta.cover ?? undefined, url: meta.url ?? "", type: meta.type ?? "youtube" });
    return (
      <li
        key={`pn-${it.id}`}
        data-flip-key={`rowpn:${it.id}`}
        className={`sb-queue-rowline sb-queue-rowline--playnext ${rowDragPresentation("pn", k).className}`}
        title={it.title}
        style={{ animationDelay: `${Math.min(k, 14) * 16}ms`, ...rowDragPresentation("pn", k).style }}
                onDragStart={(e) => e.preventDefault()}
onPointerDown={onRowPointerDown("pn", k)}
        onPointerMove={onRowPointerMove}
        onPointerUp={onRowPointerEnd}
        onPointerCancel={onRowPointerEnd}
      >
        <span className="sb-queue-rowline-thumb" data-flip-key={`pn:${it.id}`}>
          {thumb ? <HydrationSafeImage src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="sb-queue-rowline-num">{k + 1}</span>}
        </span>
        <span dir="auto" className="sb-queue-rowline-title">{it.title}</span>
        <button
          type="button"
          aria-label={`Remove "${it.title}" from Play Next`}
          title={tt("Remove from Play Next")}
          onClick={() => removePlayNextRow(it.id)}
          className="sb-queue-rowline-remove focus:outline-none"
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </li>
    );
  };
  /* 2026-10-13 (owner): wherever the queue shows covers, the order is the PLAY order — the playing
     track first, a hairline, then what comes next (rotated past the current index, so a looping
     playlist reads 3 → 0 → 1 while 2 plays). The collapsed strip and the expanded card share these
     helpers; Play Next items (the waiting list) follow under their own hairline. Display-only. */
  const sessionCount = Math.max(1, sessionTracks.length);
  const playingRows = displayedSessionTracks.filter((x) => x.originalIndex === sessionForList.highlightIndex);
  const upcomingRows = displayedSessionTracks
    .filter((x) => x.originalIndex !== sessionForList.highlightIndex)
    .slice()
    .sort(
      (a, b) =>
        ((a.originalIndex - sessionForList.highlightIndex + sessionCount) % sessionCount) -
        ((b.originalIndex - sessionForList.highlightIndex + sessionCount) % sessionCount),
    );
  /** rows after the divider: Play Next first (they really play next), then the session in play order —
      and when the playing track is detached, the session's own current row leads that group. */
  const sessionAfterRows = nowPlayingDetached ? [...playingRows, ...upcomingRows] : upcomingRows;
  return (
    <div
      ref={panelRootRef}
      className={`flex h-full min-h-0 flex-col sb-queue-view-${queueTab} ${collapsed ? "sb-queue-collapsed" : ""}`}
      onDragEnter={(e) => {
        if (e.dataTransfer?.types?.length) {
          e.preventDefault();
        }
      }}
      onDragOver={handlePanelDragOver}
      onDrop={handlePanelDrop}
    >
      {/*
       * Single-line header: tiny "QUEUE" pill + playlist name + (optional) shuffle dot + total.
       * Was a 3-row stack of "Live queue" / name+total / shuffle; that consumed too much
       * vertical real estate on the deck for what's effectively just metadata.
       */}
      <header className="shrink-0 border-b border-white/[0.06] pb-1.5">
        <div className="flex items-center gap-2">
          <div ref={tabsRef} className="sb-queue-label sb-queue-tabs min-w-0 flex-1" role="tablist" aria-label={tt("Queue categories")}>
            <button type="button" role="tab" aria-selected={queueTab === "queue"} className="sb-queue-tab" onClick={() => setQueueTab("queue")}>{tt("Queue")}</button>
            <button type="button" role="tab" aria-selected={queueTab === "jingles"} className="sb-queue-tab" onClick={() => setQueueTab("jingles")}>{tt("Jingles")}</button>
            <span className="sb-queue-tab-bar" aria-hidden />
          </div>
          {/* 2026-10-13 (owner): nothing sits between QUEUE and the chevron any more — the session
              name + totals (for a single track they just repeated the playing title) are kept for
              assistive tech only. */}
          <span className="sr-only">
            {plName}
            {totalPlaylistSeconds != null && sessionTracks.length > 0 ? ` · ${formatClockTotal(totalPlaylistSeconds)}` : ""}
            {playNextSeconds != null && playNextSeconds > 0 ? ` +${formatClockTotal(playNextSeconds)}` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              flipQuietUntilRef.current = performance.now() + 900; // the CSS transitions own this move
              writeDeckQueueCollapsed(!collapsed);
            }}
            aria-pressed={collapsed}
            aria-label={collapsed ? tt("Expand queue") : tt("Collapse queue")}
            title={collapsed ? tt("Expand queue") : tt("Collapse queue")}
            className="sb-queue-toggle shrink-0"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 3.5 5.5 8 10 12.5" />
            </svg>
          </button>
        </div>
      </header>

      {queueTab === "jingles" && !collapsed ? (
        <QueueJinglesPane
          onOpenConsole={(tab) => {
            setJinglesOpenTab(tab);
            setCenterModule("jingles");
          }}
        />
      ) : null}

      {/* 2026-10-14 (owner): the playing track sits OUTSIDE the scroll box — scrolling the list never moves it */}
      <div className="sb-queue-now shrink-0 pt-1">
        {nowPlayingDetached ? (
          <ul className="sb-queue-list flex w-full min-w-0 flex-col gap-1.5" aria-label={tt("Now playing")}>
            <li
              className="queue-row queue-row-current relative grid select-none grid-cols-[3rem_minmax(0,1fr)_auto_1.75rem] items-center gap-x-2.5 rounded-[7px] border px-2 py-1.5 leading-snug text-slate-100"
              style={nowAccentStyle}
              data-detached="true"
              title={nowPlayingDetached.title}
            >
              <span className="sb-queue-accent pointer-events-none absolute bottom-1 left-0 top-1 w-[2px] rounded-full" aria-hidden />
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-slate-800/80 ring-1 ring-white/[0.06]">
                {nowPlayingDetached.thumb ? (
                  <HydrationSafeImage src={nowPlayingDetached.thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[9px] font-bold text-slate-500">1</div>
                )}
                <span className="sr-only">{tt("Now playing")}</span>
              </div>
              <div className="min-w-0 overflow-hidden">
                <p dir="auto" className="truncate text-[14px] font-semibold leading-tight text-[#f5f5f7]" title={nowPlayingDetached.title}>
                  {nowPlayingDetached.title}
                </p>
                {!isControlMirror ? <CommunityFeedbackSummary catalogItemId={nowPlayingDetached.catalogItemId} /> : null}
              </div>
              {!isControlMirror ? (
                <span className="sb-queue-suggest" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <SuggestMetadataButton trackTitle={nowPlayingDetached.title} trackArtist={null} catalogItemId={nowPlayingDetached.catalogItemId} />
                </span>
              ) : (
                <span />
              )}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center" aria-label={tt("Now playing")}>
                <span className="queue-now-playing-bars queue-now-playing-bars--action-slot" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            </li>
          </ul>
        ) : null}
        {!nowPlayingDetached && sessionTracks.length > 0 && displayedSessionTracks.length > 0 ? (
          <ul className="sb-queue-list flex w-full min-w-0 flex-col gap-1.5">
            {displayedSessionTracks.map(({ track: t, originalIndex: i }, displayIndex) => {
              const tr = t as TrackExtra;
              const title = t.name ?? t.title ?? t.url ?? "Track";
              const artistLine =
                (tr.artist && String(tr.artist)) ||
                (tr.genre && String(tr.genre)) ||
                (sessionTracks.length === 1 && playlistGenre ? playlistGenre : null);
              const thumb = derivePlaylistTrackCoverArt({ cover: t.cover, url: t.url, type: t.type });
              const isCurrent = i === sessionForList.highlightIndex;
              const isPendingRow = pendingRowIndex !== null && i === pendingRowIndex; // P0 Gate 1f
              const isNextInList = markNextInOrder && nextLinear !== null && i === nextLinear;
              const displayNumber = displayIndex + 1;
              if (!isCurrent) return null;
              return (
                <li
                  key={`now-${t.id}`}
                  tabIndex={0}
                  role="button"
                  title={tt("Click to play")}
                  onClick={() => jumpToSessionTrack(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      jumpToSessionTrack(i);
                    }
                  }}
                  style={nowAccentStyle}
                  className={`queue-row group relative grid cursor-pointer select-none grid-cols-[3rem_minmax(0,1fr)_auto_1.75rem] items-center gap-x-2.5 rounded-[7px] border px-2 py-1.5 leading-snug transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15 ${
                    isCurrent
                      ? "queue-row-current border-white/[0.08] bg-white/[0.04] text-slate-100"
                      : isNextInList
                        ? "border-white/[0.05] bg-white/[0.02] text-slate-300 hover:bg-white/[0.04]"
                        : "border-white/[0.04] bg-transparent text-slate-400 hover:border-white/[0.06] hover:bg-white/[0.02]"
                  }`}
                >
                  {isCurrent ? (
                    <span className="sb-queue-accent pointer-events-none absolute bottom-1 left-0 top-1 w-[2px] rounded-full" aria-hidden />
                  ) : null}
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-slate-800/80 ring-1 ring-white/[0.06]" data-flip-key={`s:${t.id}`}>
                    {thumb ? (
                      <HydrationSafeImage src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[9px] font-bold text-slate-500">
                        {displayNumber}
                      </div>
                    )}
                    {isCurrent ? (
                      <span className="sr-only">{tt("Now playing")}</span>
                    ) : null}
                  </div>
                  <div className="min-w-0 overflow-hidden">
                    {/* 2026-10-13 (owner): the title takes the whole width and truncates — no marquee */}
                    <p dir="auto" className="truncate text-[14px] font-semibold leading-tight text-[#f5f5f7]" title={title}>
                      {title}
                    </p>
                    {artistLine ? (
                      <span dir="auto" className="mt-1 line-clamp-1 text-[12px] leading-snug text-[#a1a1a6]">{artistLine ? tt(artistLine) : artistLine}</span>
                    ) : null}
                    {isCurrent ? <CommunityFeedbackSummary catalogItemId={tr.catalogItemId ?? null} /> : null}
                  </div>
                  {/* USER suggestion (now-playing track only) — icon only, in its own slot (owner, 2026-10-13).
                      Saved as PENDING; never edits the catalog/MP3. */}
                  {isCurrent ? (
                    <span className="sb-queue-suggest" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <SuggestMetadataButton trackTitle={title} trackArtist={tr.artist ? String(tr.artist) : null} catalogItemId={tr.catalogItemId ?? null} />
                    </span>
                  ) : null}
                  {isPendingRow ? (
                    <span className="flex h-7 shrink-0 items-center justify-end whitespace-nowrap text-[11px] font-medium text-[#a1a1a6]" aria-label="Loading">
                      Loading…
                    </span>
                  ) : isCurrent ? (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center" aria-label={tt("Now playing")}>
                      <span className="queue-now-playing-bars queue-now-playing-bars--action-slot" aria-hidden>
                        <span />
                        <span />
                        <span />
                      </span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove "${title}" from session view`}
                      title="Remove from session view (does not change saved playlist)"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeSessionRow(i);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-slate-500/60 opacity-50 transition-all hover:bg-white/[0.04] hover:text-slate-400 hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-white/15 group-hover:opacity-75"
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                        <path
                          d="M5 3V2h6v1h3v1.4H2V3h3zm-1.5 2.4h9l-.7 8.4a1 1 0 0 1-1 .9H5.2a1 1 0 0 1-1-.9l-.7-8.4zM6.6 7v6h1V7h-1zm2.8 0v6h1V7h-1z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div className="sb-queue-body min-h-0 flex-1 basis-0 overflow-y-auto overflow-x-hidden overscroll-contain py-1 pr-0.5">
        {pendingStrip ? (
          <p className="mb-1.5 flex min-w-0 items-center gap-2 rounded-[7px] border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-[12px] leading-tight text-[#a1a1a6]" aria-live="polite">
            <span className="shrink-0 font-medium text-[#f5f5f7]">Loading…</span>
            {pendingStrip.title ? <span dir="auto" className="min-w-0 truncate">{pendingStrip.title}</span> : null}
          </p>
        ) : null}
        {sessionTracks.length === 0 ? (
          nowPlayingDetached ? null : <p className="text-[10px] leading-tight text-slate-500/70">{tt("Pick a playlist to start")}</p>
        ) : displayedSessionTracks.length === 0 ? (
          <p className="text-[10px] leading-tight text-slate-500/70">All session rows hidden</p>
        ) : null}
        {sessionAfterRows.length > 0 || visiblePlayNextQueue.length > 0 ? (
          <>
            <div className="sb-queue-divider" aria-hidden />
            <ul
              className={`sb-queue-rows w-full min-w-0 list-none ${collapsed ? "sb-queue-rows--collapsed" : ""}`}
              aria-label={tt("Up next")}
              data-drag-from={queueDrag ? queueDrag.from : undefined}
              data-drag-to={queueDrag ? queueDrag.to : undefined}
            >
              {visiblePlayNextQueue.map((it, k) => renderPlayNextRow(it, k))}
              {sessionAfterRows.map(({ track: t, originalIndex: i }, k) => renderSessionRow(t, i, k + visiblePlayNextQueue.length))}
            </ul>
          </>
        ) : null}
      </div>

      {/*
       * Staged Play Next items (when any) + slim drop target.
       * No separate "DROP NEXT" header — the pad label is the only title.
       */}
      <div
        ref={nextBlockRef}
        className={`play-next-block shrink-0 border-t border-white/[0.05] pt-1 transition-colors ${visiblePlayNextQueue.length === 0 ? "opacity-80" : ""}`}
      >
        {/* the waiting list is shown as rows right after the divider (play order); only the pad lives here */}

        <div
          tabIndex={0}
          role="button"
          aria-label="Play next - drop a library track, audio file, or paste URL"
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            setOverDrop(true);
          }}
          onDragLeave={() => setOverDrop(false)}
          onDrop={handlePadDrop}
          onPaste={onPaste}
          onMouseEnter={() => setPadHover(true)}
          onMouseLeave={() => setPadHover(false)}
          onFocus={() => setPadHover(true)}
          onBlur={() => setPadHover(false)}
          className={`play-next-pad flex min-h-[34px] cursor-copy select-none items-center justify-center rounded-lg border border-dashed px-2.5 py-1.5 text-center transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-white/20 ${
            overDrop
              ? "border-[#0a84ff]/50 bg-[#0a84ff]/10"
              : "border-white/[0.12] bg-white/[0.02] hover:border-white/[0.2] hover:bg-white/[0.04]"
          }`}
        >
          {dropHint ? (
            <p className="text-[11px] font-medium text-[#6cb2ff]" role="status">{dropHint}</p>
          ) : (
            <p className={`text-[11px] font-medium uppercase tracking-[0.14em] leading-none transition-colors ${overDrop ? "text-[#6cb2ff]" : "text-[#6e6e73]"}`}>
              {overDrop ? "Drop here" : "Drop Next"}
            </p>
          )}
        </div>
      </div>
      {queueDrag && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={(el) => {
                ghostRef.current = el;
                if (el && !el.style.transform) el.style.transform = `translateY(${queueDragRef.current?.dy ?? 0}px) scale(var(--sb-lift, 1.04))`;
              }}
              className={`sb-queue-rowline sb-queue-drag-ghost${collapsed ? " sb-queue-drag-ghost--collapsed" : ""}`}
              style={{ left: queueDrag.rect.left, top: queueDrag.rect.top, width: queueDrag.rect.width, height: queueDrag.rect.height }}
              aria-hidden
            >
              <span className="sb-queue-rowline-thumb">{queueDrag.thumb ? <img src={queueDrag.thumb} alt="" /> : null}</span>
              <span dir="auto" className="sb-queue-rowline-title">{queueDrag.title}</span>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
