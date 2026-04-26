"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaylistTrack } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { getPlaylistSessionTracks, usePlayback } from "@/lib/playback-provider";
import { isPlayNextSourceId } from "@/lib/play-next";
import {
  collectElectronFilePathsFromDataTransfer,
  getNativePathForDroppedFile,
  isLocalPathLikelyFolderInWebBrowser,
  normalizeLocalFilePathInput,
} from "@/lib/local-audio-path";
import { isValidLocalFilePlaybackPath, isValidPlaybackUrl } from "@/lib/url-validation";
import { effectivePlaybackPlaylistAttachment } from "@/lib/playlist-utils";
import type { UnifiedSource } from "@/lib/source-types";

type TrackExtra = PlaylistTrack & { durationSeconds?: number; genre?: string; artist?: string };

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

function formatClockRow(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "-";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
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
  const {
    currentSource,
    currentPlaylist,
    currentTrackIndex,
    playNextQueue,
    playNextBaseline,
    addPlayNextFromPaths,
    addPlayNextFromUrls,
    addPlayNextSources,
    removePlayNextItem,
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
    (dt: DataTransfer | null, sourcePath: string) => {
      if (!dt) return false;
      if (processedDtRef.current.has(dt)) {
        console.debug("[SyncBiz:play-next-skip-dup]", { sourcePath });
        return true;
      }
      processedDtRef.current.add(dt);

      const fromSyncbiz = extractPlayNextItemsFromSyncbizDrag(dt);
      if (fromSyncbiz.sources.length > 0) {
        console.debug("[SyncBiz:play-next-syncbiz-drag]", {
          sourcePath,
          count: fromSyncbiz.sources.length,
          firstTitles: fromSyncbiz.sources.slice(0, 4).map((s) => s.title),
          unsupported: fromSyncbiz.unsupported,
        });
        addPlayNextSources(fromSyncbiz.sources);
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
      if (dedupedPaths.length > 0) addPlayNextFromPaths(dedupedPaths);
      if (urls.length > 0) addPlayNextFromUrls(urls);
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
    [addPlayNextFromPaths, addPlayNextFromUrls, addPlayNextSources, showHint],
  );

  const ingestDrop = useCallback(
    (e: React.DragEvent, sourcePath: "pad" | "panel" = "pad") => {
      e.preventDefault();
      e.stopPropagation();
      setOverDrop(false);
      ingestDataTransfer(e.dataTransfer, sourcePath);
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
      const consumed = ingestDataTransfer(dt, "window");
      const types = [...dt.types];
      const hasSyncbiz = types.some((t) => t.startsWith("application/syncbiz-"));
      if (!consumed && hasSyncbiz) {
        showHint("Couldn't read that library item. Try dropping a different track.");
      }
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

  // Flash the NEXT section when the queue grows so the enqueue is obvious even if the list is long.
  useEffect(() => {
    const prev = prevPlayNextLenRef.current;
    prevPlayNextLenRef.current = playNextQueue.length;
    if (playNextQueue.length <= prev) return;
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
  }, [playNextQueue.length]);

  const sessionForList = useMemo(() => {
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
  }, [currentSource, currentPlaylist, currentTrackIndex, playNextBaseline]);

  const sessionTracks = useMemo(
    () => getPlaylistSessionTracks({ currentSource: sessionForList.currentSource, currentPlaylist: sessionForList.currentPlaylist }),
    [sessionForList.currentSource, sessionForList.currentPlaylist],
  );

  const onPlaylist = useMemo(() => {
    const a = sessionForList.currentSource ? effectivePlaybackPlaylistAttachment(sessionForList.currentSource) : null;
    return a ?? sessionForList.currentPlaylist;
  }, [sessionForList.currentSource, sessionForList.currentPlaylist]);

  const plName = onPlaylist?.name?.trim() || sessionForList.currentSource?.title?.trim() || "Current session";
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
  const sessionScopeId = sessionForList.currentSource?.id ?? null;
  const [removedSessionTrackIndexes, setRemovedSessionTrackIndexes] = useState<Set<number>>(
    () => new Set(),
  );
  const removedScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (removedScopeRef.current === sessionScopeId) return;
    removedScopeRef.current = sessionScopeId;
    setRemovedSessionTrackIndexes((prev) => (prev.size === 0 ? prev : new Set()));
  }, [sessionScopeId]);

  const displayedSessionTracks = useMemo(
    () =>
      sessionTracks
        .map((track, originalIndex) => ({ track, originalIndex }))
        .filter(({ originalIndex }) => !removedSessionTrackIndexes.has(originalIndex)),
    [sessionTracks, removedSessionTrackIndexes],
  );

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
    const known = playNextQueue
      .map((it) => (it as UnifiedSource & { durationSeconds?: number }).durationSeconds)
      .filter((d): d is number => typeof d === "number" && d >= 0);
    if (known.length === 0) return null;
    return known.reduce((a, b) => a + b, 0);
  }, [playNextQueue]);

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

  /**
   * Double-click jump: re-invokes playSource on the displayed session source at the requested
   * underlying track index. Reuses the existing playback path (no separate "jump" code path),
   * so MPV / embedded / queue handling stay identical to a normal Play. The saved playlist
   * tracks aren't touched — playSource just sets currentTrackIndex.
   *
   * When sessionForList is the play-next baseline (Play Next is currently active), jumping
   * effectively returns to the saved session at the chosen index. Stale playNextBaseline
   * state is harmless after that: next() only restores baseline when currentSource is a
   * playnext id, which it no longer will be.
   */
  const jumpToSessionTrack = useCallback(
    (originalIndex: number) => {
      const src = sessionForList.currentSource;
      if (!src) return;
      if (originalIndex < 0 || originalIndex >= sessionTracks.length) return;
      try {
        playSource(src, originalIndex);
      } catch (err) {
        console.warn("[SyncBiz:live-queue-jump] failed", err);
      }
    },
    [playSource, sessionForList.currentSource, sessionTracks.length],
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
      removePlayNextItem(id);
    },
    [removePlayNextItem],
  );

  return (
    <div
      ref={panelRootRef}
      className="flex h-full min-h-0 flex-col"
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
      <header className="shrink-0 border-b border-slate-800/50 pb-1">
        {/*
         * Single-line header: [QUEUE] [Playlist name] [TOTAL hh:mm:ss (+m:ss NEXT)].
         * Was two rows; collapsing onto one line freed ~16px which the session list now uses
         * to show one extra track row. Playlist name is the flex-1 truncating element so
         * arbitrarily long names degrade gracefully while TOTAL always stays visible at the
         * end. The shuffle/RANDOM ON chip was already removed (the player surface owns that).
         */}
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">QUEUE</span>
          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-100/95" title={plName}>
            {plName}
          </p>
          {totalPlaylistSeconds != null && sessionTracks.length > 0 ? (
            <span className="shrink-0 flex items-baseline gap-1 text-[10px]" title="Total duration of the active session">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">TOTAL</span>
              <span className="font-mono font-semibold tabular-nums text-sky-200/95">
                {formatClockTotal(totalPlaylistSeconds)}
              </span>
              {playNextSeconds != null && playNextSeconds > 0 ? (
                <span
                  className="font-mono tabular-nums text-emerald-300/90"
                  title="Additional time queued via Play Next (with known durations)"
                >
                  +{formatClockTotal(playNextSeconds)}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-0.5 pr-0.5">
        {sessionTracks.length === 0 ? (
          <p className="text-xs text-slate-500">No active playlist - pick one from the library to start a session.</p>
        ) : displayedSessionTracks.length === 0 ? (
          <p className="text-xs text-slate-500">All session rows hidden. Pick a different playlist to reset.</p>
        ) : (
          <div role="table" className="w-full min-w-0 text-xs">
            {/*
             * Grid columns: [LED] [#] [Title] [Time] [Trash slot]. Trash slot is a fixed 1rem
             * column reserved on every row so the layout doesn't jitter when the button shows
             * up on hover. The button itself is invisible-by-default and lights up on hover or
             * keyboard focus.
             */}
            <div
              className="grid grid-cols-[0.6rem_1.5rem_minmax(0,1fr)_2.75rem_1rem] gap-1 border-b border-slate-800/50 pb-0.5 text-[10px] font-medium text-slate-500"
              aria-hidden
            >
              <span />
              <span className="text-right font-bold">#</span>
              <span>Title</span>
              <span className="text-right">Time</span>
              <span />
            </div>
            {displayedSessionTracks.map(({ track: t, originalIndex: i }, displayIndex) => {
              const tr = t as TrackExtra;
              const title = t.name ?? t.title ?? t.url ?? "Track";
              const sub =
                (tr.artist && String(tr.artist)) ||
                (tr.genre && String(tr.genre)) ||
                (sessionTracks.length === 1 && playlistGenre ? playlistGenre : null);
              const isCurrent = i === sessionForList.highlightIndex;
              const isNextInList = markNextInOrder && nextLinear !== null && i === nextLinear;
              const rowDurationSeconds = getTrackDuration(t);
              // Display number is the position within the *visible* list (1..N), not the
              // underlying playlist index. After session-only removals the operator expects
              // sequential 1, 2, 3... — without this, hidden rows leave gaps (e.g. 18 -> 22).
              // Underlying `i` is still used everywhere it matters for behavior (jump,
              // remove, isCurrent, isNextInList) so playback stays bound to the saved order.
              const displayNumber = displayIndex + 1;
              return (
                <div
                  key={`${t.id}-${i}`}
                  role="row"
                  tabIndex={0}
                  title="Double-click to play"
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    jumpToSessionTrack(i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      jumpToSessionTrack(i);
                    }
                  }}
                  // Block native text-selection on the second mousedown of a dblclick so the
                  // operator doesn't get a flash of selected title text mid-action.
                  onMouseDown={(e) => {
                    if (e.detail > 1) e.preventDefault();
                  }}
                  className={`queue-row group grid cursor-pointer select-none grid-cols-[0.6rem_1.5rem_minmax(0,1fr)_2.75rem_1rem] items-baseline gap-1 border-b border-slate-800/25 py-0.5 leading-tight focus:outline-none focus:ring-1 focus:ring-sky-400/50 ${
                    isCurrent
                      ? "queue-row-current bg-sky-500/10 text-slate-50"
                      : isNextInList
                        ? "bg-emerald-500/5 text-slate-200 hover:bg-emerald-500/10"
                        : "text-slate-300/95 hover:bg-slate-800/40"
                  }`}
                >
                  <span className="flex h-full items-center justify-center" aria-hidden={!isCurrent}>
                    {isCurrent ? (
                      <span
                        aria-label="Now playing"
                        title="Now playing"
                        className="live-queue-led-now inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300 shadow-[0_0_6px_rgba(56,189,248,0.95)]"
                      />
                    ) : null}
                  </span>
                  <span
                    className={`flex h-full items-center justify-end font-mono text-[12px] font-bold tabular-nums ${
                      isCurrent ? "text-sky-200" : isNextInList ? "text-emerald-300/90" : "text-slate-300"
                    }`}
                    aria-hidden
                  >
                    {displayNumber}
                  </span>
                  <div className="min-w-0 overflow-hidden">
                    <div className="queue-row-title relative flex min-w-0 items-center overflow-hidden">
                      {isNextInList && !isCurrent ? <span className="me-0.5 shrink-0 text-[9px] font-bold uppercase text-emerald-400/90">Next </span> : null}
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="queue-row-title-marquee flex w-max gap-12 whitespace-nowrap" title={title}>
                          <span dir="auto" className="text-xs font-medium">{title}</span>
                          <span dir="auto" aria-hidden className="text-xs font-medium">{title}</span>
                        </div>
                      </div>
                    </div>
                    {sub ? <span dir="auto" className="line-clamp-1 text-[10px] text-slate-500/90">{sub}</span> : null}
                  </div>
                  <span className="shrink-0 text-right font-mono text-[10px] font-medium tabular-nums text-slate-200/95">
                    {formatClockRow(rowDurationSeconds)}
                  </span>
                  {/*
                   * Trash slot. Disabled on the currently-playing row (per product rule:
                   * skip-on-delete is deferred). On future rows, hidden by default; visible on
                   * row hover or button focus to keep the row dense. stopPropagation prevents
                   * the parent row's double-click from firing when the operator clicks fast.
                   */}
                  {isCurrent ? (
                    <span aria-hidden />
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
                      className="flex h-full items-center justify-center rounded text-[12px] leading-none text-slate-500/70 transition-colors hover:text-rose-300 focus:outline-none focus:ring-1 focus:ring-rose-400/60"
                    >
                      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                        <path
                          d="M5 3V2h6v1h3v1.4H2V3h3zm-1.5 2.4h9l-.7 8.4a1 1 0 0 1-1 .9H5.2a1 1 0 0 1-1-.9l-.7-8.4zM6.6 7v6h1V7h-1zm2.8 0v6h1V7h-1z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/*
       * NEXT block lists ONLY upcoming staged items. The currently-playing Play Next item
       * (when present) is intentionally NOT echoed here — the player UI already shows it
       * prominently, and operators read its presence here as "still queued / will replay".
       * Block collapses to a single 1-line header when there's nothing staged so the deck
       * height doesn't visibly change between empty and 1-item-queued states.
       */}
      <div
        ref={nextBlockRef}
        className="play-next-block shrink-0 border-t border-slate-800/45 pt-1 transition-colors"
      >
        <div className="flex items-baseline justify-between gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-200/85">NEXT</span>
          <span className="text-[9px] font-mono tabular-nums text-amber-200/60">{playNextQueue.length}</span>
        </div>
        {playNextQueue.length > 0 ? (
          /*
           * NEXT rows mirror the session-row title treatment: single line, `text-xs
           * font-medium`, and the same `queue-row-title-marquee` doubled-span structure so
           * long titles scroll horizontally instead of wrapping to a second line. Was a
           * `text-[10px]` block with `line-clamp-2 break-words` which both shrank the text
           * relative to the session list AND consumed two full vertical lines per row.
           */
          <ol className="mt-0.5 max-h-32 list-decimal space-y-px overflow-y-auto pl-4 leading-tight text-slate-200/90 marker:text-[10px] marker:font-bold marker:text-amber-200/70">
            {playNextQueue.map((it) => (
              <li key={it.id} className="group/pn flex items-center gap-1 pl-0.5">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="queue-row-title-marquee flex w-max gap-12 whitespace-nowrap" title={it.title}>
                    <span dir="auto" className="text-xs font-medium">{it.title}</span>
                    <span dir="auto" aria-hidden className="text-xs font-medium">{it.title}</span>
                  </div>
                </div>
                {/*
                 * Per-item trash for the staged NEXT list. Removes ONLY from the in-memory
                 * playNextQueue via the provider — never touches saved sources, library, or
                 * persisted playlists. Hidden by default; reveals on row hover or button focus.
                 */}
                <button
                  type="button"
                  aria-label={`Remove "${it.title}" from Play Next`}
                  title="Remove from Play Next"
                  onClick={() => removePlayNextRow(it.id)}
                  className="shrink-0 rounded text-[12px] leading-none text-amber-200/55 transition-colors hover:text-rose-300 focus:outline-none focus:ring-1 focus:ring-rose-400/60"
                >
                  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                    <path
                      d="M5 3V2h6v1h3v1.4H2V3h3zm-1.5 2.4h9l-.7 8.4a1 1 0 0 1-1 .9H5.2a1 1 0 0 1-1-.9l-.7-8.4zM6.6 7v6h1V7h-1zm2.8 0v6h1V7h-1z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

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
        className={`play-next-pad mt-1 shrink-0 cursor-copy select-none rounded-md border px-2 py-1 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${
          overDrop
            ? "border-amber-400/70 bg-amber-500/20 ring-1 ring-amber-400/40"
            : "border-amber-400/30 bg-amber-500/10 hover:border-amber-400/55 hover:bg-amber-500/15"
        }`}
      >
        {dropHint ? (
          <p className="mb-0.5 text-[10px] font-medium text-amber-200" role="status">{dropHint}</p>
        ) : null}
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-100/95 leading-tight">
          {overDrop ? "Drop here" : "DROP NEXT PLAY"}
        </p>
        <p className="mt-px text-[9px] leading-tight text-amber-200/65">
          {overDrop || padHover ? "Tile / file / URL" : "Drop track, file or URL"}
        </p>
      </div>
    </div>
  );
}
