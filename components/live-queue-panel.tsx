"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaylistTrack } from "@/lib/playlist-types";
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

type TrackExtra = PlaylistTrack & { durationSeconds?: number; genre?: string; artist?: string };

/** Thumbnail/CDN URLs — not playable as “Play Next” targets. */
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

/**
 * Pull explicit href/src-like target values out of an HTML fragment. Catches anchor hrefs
 * reliably even when the generic scanner is thrown off by surrounding markup.
 */
function collectHrefsFromHtml(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\b(?:href|data-url|data-href)\s*=\s*["']([^"']+)["']/gi)) {
    const t = m[1]?.trim();
    if (t && t.startsWith("http")) out.push(t);
  }
  return out;
}

/**
 * If the only URLs we found are YouTube thumbnails (i.ytimg.com/vi/<ID>/…), reconstruct the
 * watch URL from the video ID embedded in the path. Common when the browser drag payload is
 * the raw thumbnail image rather than the surrounding anchor.
 */
function recoverYouTubeWatchUrlFromImageUrls(imageUrls: string[]): string | null {
  for (const u of imageUrls) {
    const m = /[/.]ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,})\//i.exec(u);
    if (m?.[1]) return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  return null;
}

/**
 * Prefer `text/uri-list`, `text/html` (anchor hrefs), `text/plain`, then legacy Moz payload.
 * Filter out image/thumbnail URLs so YouTube drags resolve to the watch URL, not hqdefault.jpg.
 * If nothing but image URLs come through but we can infer a YouTube ID from a thumbnail,
 * synthesize the watch URL so the drop still lands a real, playable page URL.
 */
function extractPlayNextUrlsFromDataTransfer(dt: DataTransfer): {
  urls: string[];
  sawImageOnly: boolean;
  debug: {
    types: string[];
    uriList: string;
    plain: string;
    htmlExtracted: string[];
    imageOnly: string[];
    accepted: string[];
    recovered: string | null;
  };
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
    // Anchor-specific extraction first — most reliable for YT search-result drags where the
    // card markup wraps an <a href="…/watch?v=…"> around the thumbnail <img>.
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

  // Recovery pass: payload was image-only, but a YouTube thumbnail exposes the video ID.
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
  return {
    urls: uniq,
    sawImageOnly,
    debug: {
      types: [...dt.types],
      uriList,
      plain,
      htmlExtracted,
      imageOnly,
      accepted: uniq,
      recovered,
    },
  };
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

/** mm:ss or h:mm:ss — row */
function formatClockRow(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Header total — clock */
function formatClockTotal(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—:—";
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
    shuffle,
  } = usePlayback();
  const [overDrop, setOverDrop] = useState(false);
  const [padHover, setPadHover] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPlayNextLenRef = useRef(0);
  const nextBlockRef = useRef<HTMLDivElement | null>(null);

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

  // Flash the NEXT section whenever the queue grows, so a successful drop is obvious even
  // when the session list is long enough to push the NEXT block out of sight. Implemented as an
  // imperative class toggle on the block's DOM node rather than setState — keeps this pure
  // visual feedback out of React's render graph.
  useEffect(() => {
    const prev = prevPlayNextLenRef.current;
    prevPlayNextLenRef.current = playNextQueue.length;
    if (playNextQueue.length <= prev) return;
    const node = nextBlockRef.current;
    if (!node) return;
    if (flashTimer.current) clearTimeout(flashTimer.current);
    node.classList.remove("play-next-block-flash");
    // Force reflow so removing + re-adding the class restarts the animation even on rapid drops.
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

  const totalPlaylistSeconds = useMemo(() => {
    const durs = sessionTracks.map((t) => (t as TrackExtra).durationSeconds);
    if (durs.length > 0 && durs.every((d) => typeof d === "number" && d >= 0)) {
      return durs.reduce<number>((a, b) => a + (b as number), 0);
    }
    const plS = (onPlaylist as { durationSeconds?: number } | null)?.durationSeconds;
    if (typeof plS === "number" && plS >= 0) return plS;
    const sumKnown = durs
      .filter((d): d is number => typeof d === "number" && d >= 0)
      .reduce((a, b) => a + b, 0);
    return sumKnown > 0 ? sumKnown : null;
  }, [onPlaylist, sessionTracks]);

  const onPlayNext = isPlayNextSourceId(currentSource?.id);

  const markNextInOrder = !shuffle && sessionTracks.length > 0;
  const nextLinear = useMemo(() => {
    if (!markNextInOrder) return null;
    if (sessionTracks.length === 1) return 0;
    if (sessionForList.highlightIndex < sessionTracks.length - 1) {
      return sessionForList.highlightIndex + 1;
    }
    return 0;
  }, [markNextInOrder, sessionForList.highlightIndex, sessionTracks.length]);

  const ingestDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOverDrop(false);
      const dt = e.dataTransfer;
      // Entry trace: confirms the drop reached the pad and summarises what the browser handed us.
      console.debug("[SyncBiz:play-next-drop-entry]", {
        types: [...dt.types],
        filesLen: dt.files.length,
        itemsLen: dt.items.length,
        uriListLen: dt.getData("text/uri-list").length,
        plainLen: dt.getData("text/plain").length,
        htmlLen: dt.getData("text/html").length,
        desktopPreload: typeof window !== "undefined" && !!window.syncbizDesktop?.getPathForFile,
      });
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
      const { urls, sawImageOnly, debug } = extractPlayNextUrlsFromDataTransfer(dt);
      // TEMP: trace URL extraction so we can diagnose odd browser drag payloads. Remove once stable.
      console.debug("[SyncBiz:play-next-url-extract]", debug);
      if (paths.length > 0) {
        // TEMP: one-line trace for file drops (paths + count); remove when stable.
        console.debug("[SyncBiz:play-next-drop]", {
          dataTransferFiles: dt.files.length,
          dataTransferItems: dt.items.length,
          nativeSample: typeof File !== "undefined" && dt.files[0] ? getNativePathForDroppedFile(dt.files[0]!) : null,
          resolvedPaths: paths,
          willEnqueue: paths.length,
        });
        addPlayNextFromPaths(paths);
      }
      if (urls.length > 0) addPlayNextFromUrls(urls);
      if (paths.length === 0 && urls.length === 0) {
        if (sawImageOnly || hadImageFiles) {
          showHint("That’s an image or thumbnail — drop the video or page link (e.g. youtube.com/watch…), not a .jpg.");
        } else if (dt.files.length > 0 && !window?.syncbizDesktop?.getPathForFile) {
          // Web browsers don't expose absolute paths for local files — only Electron does.
          showHint("Local file drops need the desktop app. Use a URL here, or drag the file in Desktop mode.");
        } else {
          showHint("Nothing playable in that drop. Try a video/page URL or an audio file.");
        }
      }
    },
    [addPlayNextFromPaths, addPlayNextFromUrls, showHint],
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 space-y-0.5 border-b border-slate-800/50 pb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400/90">Live queue</p>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-slate-200/95" title={plName}>
            {plName}
          </p>
          {totalPlaylistSeconds != null && sessionTracks.length > 0 ? (
            <div className="shrink-0 text-right">
              <p className="text-[9px] font-medium text-slate-500">Total</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-sky-200" title="Session duration">
                {formatClockTotal(totalPlaylistSeconds)}
              </p>
            </div>
          ) : null}
        </div>
        {shuffle && sessionTracks.length > 0 ? (
          <p className="text-[10px] text-amber-200/80">Shuffle on — order varies</p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-0.5 pr-0.5">
        {sessionTracks.length === 0 ? (
          <p className="text-xs text-slate-500">No active playlist</p>
        ) : (
          <div role="table" className="w-full min-w-0 text-xs">
            <div
              className="grid grid-cols-[1.5rem_1fr_2.75rem] gap-1 border-b border-slate-800/50 pb-0.5 text-[10px] font-medium text-slate-500"
              aria-hidden
            >
              <span className="text-right">#</span>
              <span>Title</span>
              <span className="text-right">Time</span>
            </div>
            {sessionTracks.map((t, i) => {
              const tr = t as TrackExtra;
              const title = t.name ?? t.title ?? t.url ?? "Track";
              const sub =
                (tr.artist && String(tr.artist)) ||
                (tr.genre && String(tr.genre)) ||
                (sessionTracks.length === 1 && playlistGenre ? playlistGenre : null);
              const isCurrent = i === sessionForList.highlightIndex;
              const isNextInList = markNextInOrder && nextLinear !== null && i === nextLinear;
              return (
                <div
                  key={`${t.id}-${i}`}
                  className={`queue-row group grid grid-cols-[1.5rem_minmax(0,1fr)_2.75rem] items-baseline gap-1 border-b border-slate-800/25 py-0.5 leading-tight ${
                    isCurrent
                      ? "queue-row-current bg-sky-500/10 text-slate-50"
                      : isNextInList
                        ? "bg-emerald-500/5 text-slate-200"
                        : "text-slate-300/95"
                  }`}
                >
                  <span className="text-right font-mono text-[10px] tabular-nums text-slate-500">{i + 1}</span>
                  <div className="min-w-0 overflow-hidden">
                    <div className="queue-row-title relative flex min-w-0 items-center overflow-hidden">
                      {isCurrent ? (
                        <span
                          aria-label="Now playing"
                          title="Now playing"
                          className="live-queue-led-now me-1 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300 shadow-[0_0_6px_rgba(56,189,248,0.95)]"
                        />
                      ) : null}
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
                    {formatClockRow(tr.durationSeconds)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/*
       * NEXT block sits OUTSIDE the scrollable middle so a successful drop is always visible —
       * even when the session list is long enough to hide the bottom of the scroll. Has its own
       * internal scroll for >3 queued items. Flash class pulses briefly after a drop to confirm
       * the enqueue even if the list was already non-empty.
       */}
      <div
        ref={nextBlockRef}
        className="play-next-block shrink-0 border-t border-slate-800/45 pt-1.5 transition-colors"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200/85">Next</p>
        {onPlayNext && currentSource ? (
          <p className="line-clamp-2 text-[10px] leading-snug text-amber-100/90">{currentSource.title}</p>
        ) : null}
        {playNextQueue.length === 0 && !onPlayNext ? <p className="text-[10px] text-slate-500/90">(empty)</p> : null}
        {playNextQueue.length > 0 ? (
          <ol className="mt-0.5 max-h-[4.5rem] list-decimal space-y-px overflow-y-auto pl-4 text-[10px] text-slate-200/90">
            {playNextQueue.map((it) => (
              <li key={it.id} className="line-clamp-2 break-words pl-0.5">
                {it.title}
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div
        tabIndex={0}
        role="button"
        aria-label="Play next — drop audio file or paste URL"
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.debug("[SyncBiz:play-next-drag-enter]");
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          setOverDrop(true);
        }}
        onDragLeave={() => setOverDrop(false)}
        onDrop={ingestDrop}
        onPaste={onPaste}
        onMouseEnter={() => setPadHover(true)}
        onMouseLeave={() => setPadHover(false)}
        onFocus={() => setPadHover(true)}
        onBlur={() => setPadHover(false)}
        className={`play-next-pad mt-auto shrink-0 cursor-copy select-none rounded-xl border px-3 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all focus:outline-none focus:ring-2 focus:ring-amber-400/50 ${
          overDrop
            ? "border-amber-400/70 bg-amber-500/20 ring-1 ring-amber-400/40"
            : "border-amber-400/30 bg-amber-500/10 hover:border-amber-400/55 hover:bg-amber-500/15"
        }`}
      >
        {dropHint ? (
          <p className="mb-1 text-[10px] font-medium text-amber-200">{dropHint}</p>
        ) : null}
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-amber-100">
          Play next
        </p>
        {(overDrop || padHover) && !dropHint ? (
          <p className="mt-0.5 text-[10px] leading-snug text-amber-200/90">
            Drop audio file or paste URL
          </p>
        ) : null}
      </div>
    </div>
  );
}
