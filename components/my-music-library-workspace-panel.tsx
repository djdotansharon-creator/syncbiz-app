"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactElement,
} from "react";
import type { UnifiedSource } from "@/lib/source-types";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { usePlayback } from "@/lib/playback-provider";
import { useTranslations } from "@/lib/locale-context";
import { createPlayNextLocalSource } from "@/lib/play-next";
import {
  createUnifiedPlaylistFromLocalFile,
  createUnifiedPlaylistFromLocalScan,
} from "@/lib/local-music-library-playlist";
import { M3uYoutubeResolveModal } from "@/components/m3u-youtube-resolve-modal";
import { buildM3uYoutubeResolveContext, unresolvedM3uSummaryHint } from "@/lib/m3u-youtube-resolve-shared";
import type { M3uYoutubeResolveContextState } from "@/lib/m3u-youtube-resolve-shared";
import { buildEphemeralLocalQueueFromPaths } from "@/lib/ephemeral-local-music-playback";
import { setMusicLibraryDragData } from "@/lib/music-library-drag";
import {
  getNativePathForDroppedFile,
  getPlaylistContainerPathFromDataTransfer,
  isPlaylistContainerPath,
} from "@/lib/local-audio-path";

export type MyMusicPlaylistPickerOption = { key: string; label: string };

type AddToPlaylistModalTarget =
  | { kind: "folder"; path: string; defaultName: string }
  | { kind: "file"; path: string; defaultName: string };

type AddToPlaylistModalStep = "menu" | "create" | "existing";

type AddToPlaylistFeedback =
  | { phase: "idle" }
  | { phase: "loading"; message: string }
  | { phase: "ok"; message: string }
  | { phase: "error"; message: string };

function isElectronWithBridge(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.syncbizDesktop);
}

function canListMusicLibrary(): boolean {
  return typeof window !== "undefined" && typeof window.syncbizDesktop?.listMusicLibraryDir === "function";
}

function canPickMusicFolder(): boolean {
  return typeof window !== "undefined" && typeof window.syncbizDesktop?.pickMusicFolder === "function";
}

function canGetLocalAudioTags(): boolean {
  return typeof window !== "undefined" && typeof window.syncbizDesktop?.getLocalAudioTags === "function";
}

function canImportM3u(): boolean {
  return typeof window !== "undefined" && typeof window.syncbizDesktop?.importLocalM3uPlaylist === "function";
}

/** Mirrors desktop `LocalAudioTagFields` (preload IPC); duplicated here so Next doesn’t depend on desktop package. */
type LocalAudioBrowseTags = {
  artist: string | null;
  title: string | null;
  album: string | null;
  genre: string | null;
  year: string | null;
  comment: string | null;
  durationSec: number | null;
  bpm: number | null;
  rating: number | null;
};

function IconFolderGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

/** Local-browser placeholder: stacked vinyl + simplified deck silhouette (syncs with slate/cyan UI). */
function LocalLibraryDeckPlaceholder({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.35"
        d="M8 38h32a2 2 0 0 0 2-2v-6H6v6a2 2 0 0 0 2 2z"
      />
      <rect x="6" y="14" width="36" height="16" rx="3" stroke="currentColor" strokeWidth="1.35" opacity="0.45" />
      <circle cx="18" cy="22" r="6" stroke="currentColor" strokeWidth="1.35" opacity="0.55" />
      <circle cx="18" cy="22" r="1.75" fill="currentColor" opacity="0.4" />
      <circle cx="30" cy="22" r="5" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      <circle cx="30" cy="22" r="1.35" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

function MusicLibraryTrackThumb({ absolutePath }: { absolutePath: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const api = typeof window !== "undefined" ? window.syncbizDesktop?.getLocalAudioCover : undefined;
    if (typeof api !== "function") return undefined;
    void (async () => {
      try {
        const res = await api(absolutePath);
        if (!cancelled && res.status === "ok" && res.dataUrl) setDataUrl(res.dataUrl);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [absolutePath]);

  return (
    <span className="flex h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-700/45 bg-slate-950/65">
      {dataUrl ? (
        <HydrationSafeImage src={dataUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sky-500/55">
          <LocalLibraryDeckPlaceholder className="h-10 w-10" />
        </span>
      )}
    </span>
  );
}

const TITLE_SPLIT_SEPARATORS = [" - ", " – ", " — "] as const;

/**
 * Display-only Artist/Title fallback split. Triggered ONLY when the file has no
 * `common.artist` and `common.title` contains exactly one of " - ", " – ", " — ".
 * Both sides must be non-empty after trim. Raw tags are not modified.
 */
function splitArtistFromTitleFallback(
  rawArtist: string,
  rawTitle: string,
): { artist: string; title: string; split: boolean } {
  if (rawArtist || !rawTitle) return { artist: rawArtist, title: rawTitle, split: false };
  for (const sep of TITLE_SPLIT_SEPARATORS) {
    const first = rawTitle.indexOf(sep);
    if (first <= 0) continue;
    const last = rawTitle.lastIndexOf(sep);
    if (first !== last) continue; // Skip ambiguous "A - B - C" cases.
    const left = rawTitle.slice(0, first).trim();
    const right = rawTitle.slice(first + sep.length).trim();
    if (left && right) return { artist: left, title: right, split: true };
  }
  return { artist: rawArtist, title: rawTitle, split: false };
}

function resolvedArtistTitle(tags: LocalAudioBrowseTags | null): { artist: string; title: string } {
  const rawArtist = tags?.artist?.trim() || "";
  const rawTitle = tags?.title?.trim() || "";
  const r = splitArtistFromTitleFallback(rawArtist, rawTitle);
  return { artist: r.artist, title: r.title };
}

/** On-demand dev tool: prints raw common.* values for one file to the renderer console. */
async function inspectRawTagsAndLog(filePath: string): Promise<void> {
  const api = typeof window !== "undefined" ? window.syncbizDesktop?.inspectLocalAudioTagsRaw : undefined;
  if (typeof api !== "function") {
    console.info("[SyncBiz:tag-inspect] inspector not available (update Desktop)");
    return;
  }
  try {
    const res = await api(filePath);
    if (res.status === "ok") {
      console.info("[SyncBiz:tag-inspect]", res.payload);
    } else {
      console.info("[SyncBiz:tag-inspect] error", res.message);
    }
  } catch (e) {
    console.info("[SyncBiz:tag-inspect] threw", e);
  }
}

type TrackSortKey = "artist" | "title" | "genre" | "year";

type TrackTableFile = {
  name: string;
  path: string;
  /** Stage 4B: from LIST_MUSIC_LIBRARY_DIR when snapshot matches file stats. */
  snapshotTags?: {
    artist: string | null;
    title: string | null;
    genre: string | null;
    year: string | null;
    album: string | null;
    durationSec: number | null;
  };
};

function getTagFieldForSort(
  file: TrackTableFile,
  tags: LocalAudioBrowseTags | null,
  key: TrackSortKey,
): string | number | null {
  if (key === "title") {
    const { title } = resolvedArtistTitle(tags);
    return (title || file.name).toLowerCase();
  }
  if (key === "artist") {
    const { artist } = resolvedArtistTitle(tags);
    return artist ? artist.toLowerCase() : null;
  }
  if (key === "genre") return tags?.genre?.trim().toLowerCase() ?? null;
  if (key === "year") {
    const n = tags?.year ? Number(tags.year) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function compareSortValues(
  a: string | number | null,
  b: string | number | null,
  dir: "asc" | "desc",
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const cmp = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return dir === "asc" ? cmp : -cmp;
}

type TrackTableRowProps = {
  file: TrackTableFile;
  tags: LocalAudioBrowseTags | null;
  onTagsLoaded: (path: string, tags: LocalAudioBrowseTags | null) => void;
  onPlay: (path: string) => void;
  onAddToPlaylist: (file: TrackTableFile) => void;
  onDragStartFile: (e: ReactDragEvent<HTMLTableRowElement>, path: string) => void;
  isPlayBusy: boolean;
  isAddDisabled: boolean;
  index: number;
};

function TrackTableRow({
  file,
  tags,
  onTagsLoaded,
  onPlay,
  onAddToPlaylist,
  onDragStartFile,
  isPlayBusy,
  isAddDisabled,
}: TrackTableRowProps): ReactElement {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [loading, setLoading] = useState(false);
  const tagsRef = useRef(tags);
  tagsRef.current = tags;

  useEffect(() => {
    if (!canGetLocalAudioTags()) return undefined;
    const el = rowRef.current;
    if (!el) return undefined;
    let cancelled = false;
    let didRunLoad = false;
    const load = (): void => {
      if (didRunLoad) return;
      didRunLoad = true;
      if (!tagsRef.current) setLoading(true);
      void (async () => {
        try {
          const api = window.syncbizDesktop!.getLocalAudioTags!;
          const res = await api(file.path);
          if (cancelled) return;
          onTagsLoaded(file.path, res.status === "ok" ? res.tags : null);
        } catch {
          if (cancelled) return;
          onTagsLoaded(file.path, null);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    };
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            obs.disconnect();
            load();
            break;
          }
        }
      },
      { root: null, rootMargin: "240px 0px", threshold: 0.01 },
    );
    obs.observe(el);
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [file.path, onTagsLoaded]);

  const { artist, title: titleTagged } = resolvedArtistTitle(tags);
  const titleShown = titleTagged || file.name.replace(/\.[^/.]+$/, "");
  const genre = tags?.genre?.trim() || "";
  const year = tags?.year?.trim() || "";
  const showLoadingHint = loading && !tags;

  return (
    <tr
      ref={rowRef}
      draggable
      onDragStart={(e) => onDragStartFile(e, file.path)}
      onDoubleClick={() => onPlay(file.path)}
      className="cursor-grab align-middle transition active:cursor-grabbing"
    >
      <td className="px-3 py-2">
        <MusicLibraryTrackThumb absolutePath={file.path} />
      </td>
      <td className="sb-cp-2 max-w-[12rem] px-3 py-2 text-sm">
        <div className="sb-cp-clip">{artist || <span className="sb-cp-faint">—</span>}</div>
      </td>
      <td className="sb-cp-ink max-w-[18rem] px-3 py-2 text-sm font-medium">
        <div className="sb-cp-clip">{titleShown}</div>
        {!titleTagged ? <div className="sb-cp-faint sb-cp-clip font-mono text-[10px]">{file.name}</div> : null}
      </td>
      <td className="sb-cp-2 max-w-[10rem] px-3 py-2 text-xs capitalize">
        <div className="sb-cp-clip">{genre || <span className="sb-cp-faint">{showLoadingHint ? "…" : "—"}</span>}</div>
      </td>
      <td className="sb-cp-2 px-3 py-2 text-xs tabular-nums">{year || <span className="sb-cp-faint">—</span>}</td>
      <td className="px-3 py-2 text-end">
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          {process.env.NODE_ENV !== "production" ? (
            <button
              type="button"
              onClick={() => void inspectRawTagsAndLog(file.path)}
              aria-label="Inspect raw tags"
              className="sb-cp-icon-btn !h-7 !w-7 text-[10px] font-semibold"
            >
              i
            </button>
          ) : null}
          <button
            type="button"
            disabled={isAddDisabled || isPlayBusy}
            onClick={() => onAddToPlaylist(file)}
            aria-label="Add to Playlist"
            className="sb-cp-icon-btn"
          >
            <IconPlus className="h-4 w-4" />
          </button>
          <button type="button" disabled={isPlayBusy} onClick={() => onPlay(file.path)} aria-label="Play" className="sb-cp-icon-btn">
            {isPlayBusy ? <span className="text-xs">…</span> : <IconPlay className="h-4 w-4" />}
          </button>
        </div>
      </td>
    </tr>
  );
}

type TrackTableProps = {
  files: TrackTableFile[];
  scanBusyPath: string | null;
  addFlowBusy: boolean;
  onPlay: (path: string) => void;
  onAddToPlaylist: (file: TrackTableFile) => void;
  onDragStartFile: (e: ReactDragEvent<HTMLTableRowElement>, path: string) => void;
};

function TrackTable({
  files,
  scanBusyPath,
  addFlowBusy,
  onPlay,
  onAddToPlaylist,
  onDragStartFile,
}: TrackTableProps): ReactElement {
  const [tagsByPath, setTagsByPath] = useState<Record<string, LocalAudioBrowseTags | null>>({});
  const [sortKey, setSortKey] = useState<TrackSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setTagsByPath((prev) => {
      const next: Record<string, LocalAudioBrowseTags | null> = {};
      const pathSet = new Set(files.map((f) => f.path));
      for (const key of Object.keys(prev)) {
        if (pathSet.has(key)) next[key] = prev[key];
      }
      for (const f of files) {
        if (f.snapshotTags) {
          next[f.path] = {
            artist: f.snapshotTags.artist,
            title: f.snapshotTags.title,
            album: f.snapshotTags.album,
            genre: f.snapshotTags.genre,
            year: f.snapshotTags.year,
            comment: null,
            durationSec: f.snapshotTags.durationSec,
            bpm: null,
            rating: null,
          };
        }
      }
      return next;
    });
  }, [files]);

  const handleTagsLoaded = useCallback((path: string, tags: LocalAudioBrowseTags | null) => {
    setTagsByPath((prev) => (prev[path] === tags ? prev : { ...prev, [path]: tags }));
  }, []);

  const sortedFiles = useMemo(() => {
    if (!sortKey) return files;
    return [...files].sort((a, b) => {
      const va = getTagFieldForSort(a, tagsByPath[a.path] ?? null, sortKey);
      const vb = getTagFieldForSort(b, tagsByPath[b.path] ?? null, sortKey);
      return compareSortValues(va, vb, sortDir);
    });
  }, [files, sortKey, sortDir, tagsByPath]);

  const toggleSort = useCallback((key: TrackSortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const sortIndicator = (key: TrackSortKey): string => (sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "");

  type Col = { key: TrackSortKey | null; label: string; align?: "left" | "right" | "center"; widthClass?: string };
  const columns: Col[] = [
    { key: null, label: "", widthClass: "w-[64px]" },
    { key: "artist", label: "Artist" },
    { key: "title", label: "Title" },
    { key: "genre", label: "Genre" },
    { key: "year", label: "Year" },
    { key: null, label: "", align: "right" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="sb-cp-table w-full min-w-[560px] table-auto border-collapse text-start">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={`${c.label}-${i}`} className={`px-3 py-2 ${c.widthClass ?? ""} ${c.align === "right" ? "text-end" : "text-start"}`}>
                {c.key ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key as TrackSortKey)}
                    className="inline-flex items-center gap-1 uppercase transition hover:opacity-80"
                  >
                    {c.label}
                    <span className="text-[9px]">{sortIndicator(c.key as TrackSortKey)}</span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedFiles.map((f, idx) => (
            <TrackTableRow
              key={f.path}
              file={f}
              index={idx}
              tags={tagsByPath[f.path] ?? null}
              onTagsLoaded={handleTagsLoaded}
              onPlay={onPlay}
              onAddToPlaylist={onAddToPlaylist}
              onDragStartFile={onDragStartFile}
              isPlayBusy={scanBusyPath === f.path}
              isAddDisabled={addFlowBusy}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
      <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


type ListResult =
  | {
      status: "ok";
      dirs: { name: string; path: string }[];
      files: TrackTableFile[];
    }
  | { status: "error"; message: string }
  | { status: "no_root" };

export function MyMusicLibraryWorkspacePanel({
  onClose,
  onAddToLibrary,
  userPlaylists,
  onAppendLocalUnifiedToPlaylist,
  onPlaylistUpdated,
}: {
  onClose: () => void;
  onAddToLibrary: (source: UnifiedSource) => void;
  userPlaylists: MyMusicPlaylistPickerOption[];
  onAppendLocalUnifiedToPlaylist: (playlistKey: string, items: UnifiedSource[]) => Promise<void>;
  /** After mixed local+YouTube patch (Stage 5C-C). Optional — library grid updates when provided. */
  onPlaylistUpdated?: (source: UnifiedSource) => void;
}): ReactElement {
  const { t } = useTranslations();
  const { playSource, setQueue } = usePlayback();
  const defaultGenre = t.defaultGenreMixed ?? "Mixed";

  const [rootPath, setRootPath] = useState<string | null>(null);
  const [relSubpath, setRelSubpath] = useState("");
  const [list, setList] = useState<ListResult | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [scanBusy, setScanBusy] = useState<string | null>(null);
  const [folderPickBusy, setFolderPickBusy] = useState(false);
  const [folderPickError, setFolderPickError] = useState<string | null>(null);

  const [addModalTarget, setAddModalTarget] = useState<AddToPlaylistModalTarget | null>(null);
  const [addModalStep, setAddModalStep] = useState<AddToPlaylistModalStep>("menu");
  const [createNameDraft, setCreateNameDraft] = useState("");
  const [pickedPlaylistKey, setPickedPlaylistKey] = useState<string | null>(null);
  const [addFeedback, setAddFeedback] = useState<AddToPlaylistFeedback>({ phase: "idle" });
  const [addFlowBusy, setAddFlowBusy] = useState(false);

  const [m3uImportBusy, setM3uImportBusy] = useState(false);
  const [m3uImportSummary, setM3uImportSummary] = useState<{
    imported: number;
    unresolved: number;
    skipped: number;
    error?: string;
    /** First unresolved row’s suggested query (and count of additional). */
    unresolvedHint?: string;
  } | null>(null);
  const [m3uDropHighlight, setM3uDropHighlight] = useState(false);
  const m3uFileInputRef = useRef<HTMLInputElement | null>(null);
  const m3uDragDepthRef = useRef(0);
  /** Stage 5C-C: PATCH target after “Find missing on YouTube”. */
  const [youtubeResolveOpen, setYoutubeResolveOpen] = useState(false);
  const [m3uYoutubeResolveContext, setM3uYoutubeResolveContext] = useState<M3uYoutubeResolveContextState | null>(null);

  const hasUserPlaylists = userPlaylists.length > 0;

  const refreshRoot = useCallback(async () => {
    if (!isElectronWithBridge() || !window.syncbizDesktop?.getMusicFolder) {
      setRootPath(null);
      return;
    }
    const snap = await window.syncbizDesktop.getMusicFolder();
    setRootPath(snap.path?.trim() ? snap.path : null);
  }, []);

  useEffect(() => {
    void refreshRoot();
  }, [refreshRoot]);

  const loadList = useCallback(async () => {
    if (!canListMusicLibrary()) {
      setList({ status: "no_root" });
      return;
    }
    if (!rootPath) {
      setList({ status: "no_root" });
      return;
    }
    setListLoading(true);
    try {
      const res = await window.syncbizDesktop!.listMusicLibraryDir!(relSubpath);
      setList(res);
    } catch (e) {
      setList({ status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setListLoading(false);
    }
  }, [rootPath, relSubpath]);

  useEffect(() => {
    if (!rootPath) {
      setList(null);
      return;
    }
    void loadList();
  }, [rootPath, relSubpath, loadList]);

  const segments = useMemo(() => (relSubpath ? relSubpath.split("/").filter(Boolean) : []), [relSubpath]);

  const browseFolderAudioPaths = useMemo(() => {
    if (list?.status !== "ok") return [];
    return list.files.map((f) => f.path.trim()).filter(Boolean);
  }, [list]);

  const navigateUp = useCallback(() => {
    if (!segments.length) return;
    const next = segments.slice(0, -1);
    setRelSubpath(next.length ? next.join("/") : "");
  }, [segments]);

  const navigateToSegment = useCallback(
    (index: number) => {
      if (index < 0) {
        setRelSubpath("");
        return;
      }
      setRelSubpath(segments.slice(0, index + 1).join("/"));
    },
    [segments],
  );

  const chooseMusicFolderFromPanel = useCallback(async () => {
    const api = window.syncbizDesktop?.pickMusicFolder;
    if (typeof api !== "function") return;
    setFolderPickBusy(true);
    setFolderPickError(null);
    try {
      const result = await api();
      if (result.status === "ok") {
        setRelSubpath("");
        await refreshRoot();
      } else if (result.status === "error") {
        setFolderPickError(result.message);
      }
    } catch (e) {
      setFolderPickError(e instanceof Error ? e.message : String(e));
    } finally {
      setFolderPickBusy(false);
    }
  }, [refreshRoot]);

  const playTrackInCurrentBrowseFolder = useCallback(
    async (absPath: string) => {
      const trimmed = absPath.trim();
      const ordered = browseFolderAudioPaths.length ? browseFolderAudioPaths : [trimmed];
      const idx = ordered.indexOf(trimmed);
      const pathsToQueue = idx >= 0 ? ordered : [trimmed];
      const startIdx = idx >= 0 ? idx : 0;
      setScanBusy(trimmed);
      try {
        const queue = buildEphemeralLocalQueueFromPaths(pathsToQueue);
        setQueue(queue, { force: true });
        playSource(queue[startIdx]!);
      } finally {
        setScanBusy(null);
      }
    },
    [playSource, setQueue, browseFolderAudioPaths],
  );

  const scanAndPlayFolder = useCallback(
    async (absPath: string) => {
      const scan = window.syncbizDesktop?.scanLocalAudioFolder;
      if (typeof scan !== "function") return;
      setScanBusy(absPath);
      try {
        const result = await scan(absPath);
        if (result.status !== "ok" || result.files.length === 0) return;
        const queue = buildEphemeralLocalQueueFromPaths(result.files);
        setQueue(queue, { force: true });
        playSource(queue[0]!);
      } finally {
        setScanBusy(null);
      }
    },
    [playSource, setQueue],
  );

  const resetAddModal = useCallback(() => {
    setAddModalTarget(null);
    setAddModalStep("menu");
    setCreateNameDraft("");
    setPickedPlaylistKey(null);
    setAddFeedback({ phase: "idle" });
    setAddFlowBusy(false);
  }, []);

  const openAddModal = useCallback((target: AddToPlaylistModalTarget) => {
    setAddModalTarget(target);
    setAddModalStep("menu");
    setCreateNameDraft(target.defaultName);
    setPickedPlaylistKey(null);
    setAddFeedback({ phase: "idle" });
    setAddFlowBusy(false);
  }, []);

  const runCreateSavedPlaylist = useCallback(async () => {
    if (!addModalTarget) return;
    const nameFallback = createNameDraft.trim() || addModalTarget.defaultName;
    setAddFlowBusy(true);
    try {
      if (addModalTarget.kind === "folder") {
        const scan = window.syncbizDesktop?.scanLocalAudioFolder;
        if (typeof scan !== "function") {
          setAddFeedback({ phase: "error", message: "Desktop scan is unavailable." });
          return;
        }
        setAddFeedback({ phase: "loading", message: "Scanning folder…" });
        const result = await scan(addModalTarget.path);
        if (result.status !== "ok" || result.files.length === 0) {
          setAddFeedback({ phase: "error", message: "No playable audio files in that folder." });
          return;
        }
        setAddFeedback({ phase: "loading", message: "Saving playlist…" });
        const unified = await createUnifiedPlaylistFromLocalScan(
          { playlistName: nameFallback, files: result.files },
          defaultGenre,
        );
        if (!unified) {
          setAddFeedback({ phase: "error", message: "Could not create playlist." });
          return;
        }
        onAddToLibrary(unified);
        setAddFeedback({ phase: "ok", message: `Created “${unified.title}”.` });
      } else {
        setAddFeedback({ phase: "loading", message: "Saving playlist…" });
        const unified = await createUnifiedPlaylistFromLocalFile(addModalTarget.path, defaultGenre, {
          name: nameFallback,
        });
        if (!unified) {
          setAddFeedback({ phase: "error", message: "Could not create playlist." });
          return;
        }
        onAddToLibrary(unified);
        setAddFeedback({ phase: "ok", message: `Created “${unified.title}”.` });
      }
    } catch (e) {
      setAddFeedback({
        phase: "error",
        message: e instanceof Error ? e.message : "Something went wrong.",
      });
    } finally {
      setAddFlowBusy(false);
    }
  }, [addModalTarget, createNameDraft, defaultGenre, onAddToLibrary]);

  const runAppendToExistingPlaylist = useCallback(async () => {
    if (!addModalTarget || !pickedPlaylistKey) return;
    setAddFlowBusy(true);
    try {
      let items: UnifiedSource[] = [];
      if (addModalTarget.kind === "folder") {
        const scan = window.syncbizDesktop?.scanLocalAudioFolder;
        if (typeof scan !== "function") {
          setAddFeedback({ phase: "error", message: "Desktop scan is unavailable." });
          return;
        }
        setAddFeedback({ phase: "loading", message: "Scanning folder…" });
        const result = await scan(addModalTarget.path);
        if (result.status !== "ok" || result.files.length === 0) {
          setAddFeedback({ phase: "error", message: "No playable audio files in that folder." });
          return;
        }
        items = result.files.map((p) => createPlayNextLocalSource(p.trim()));
      } else {
        setAddFeedback({ phase: "loading", message: "Preparing track…" });
        items = [createPlayNextLocalSource(addModalTarget.path.trim())];
      }
      setAddFeedback({ phase: "loading", message: "Updating playlist…" });
      await onAppendLocalUnifiedToPlaylist(pickedPlaylistKey, items);
      setAddFeedback({
        phase: "ok",
        message: `Added ${items.length} track${items.length === 1 ? "" : "s"} to playlist.`,
      });
    } catch (e) {
      setAddFeedback({
        phase: "error",
        message: e instanceof Error ? e.message : "Something went wrong.",
      });
    } finally {
      setAddFlowBusy(false);
    }
  }, [addModalTarget, pickedPlaylistKey, onAppendLocalUnifiedToPlaylist]);

  const runM3uImport = useCallback(
    async (absolutePath: string) => {
      const trimmed = absolutePath.trim();
      if (!trimmed) return;
      if (!isPlaylistContainerPath(trimmed)) {
        setM3uImportSummary({
          imported: 0,
          unresolved: 0,
          skipped: 0,
          error: "Choose a .m3u, .m3u8, or .pls playlist file.",
        });
        return;
      }
      if (typeof window.syncbizDesktop?.importLocalM3uPlaylist !== "function") {
        setM3uImportSummary({
          imported: 0,
          unresolved: 0,
          skipped: 0,
          error: "Update SyncBiz Desktop to import playlist files.",
        });
        return;
      }
      if (!rootPath?.trim()) {
        setM3uImportSummary({
          imported: 0,
          unresolved: 0,
          skipped: 0,
          error: "Choose a music folder first (imports only include tracks inside it).",
        });
        return;
      }
      setM3uImportBusy(true);
      setM3uImportSummary(null);
      setM3uYoutubeResolveContext(null);
      setYoutubeResolveOpen(false);
      try {
        const res = await window.syncbizDesktop.importLocalM3uPlaylist(trimmed);
        if (res.status === "error") {
          setM3uImportSummary({ imported: 0, unresolved: 0, skipped: 0, error: res.message });
          return;
        }
        const hasTracks = res.files.length > 0;
        const hasUnresolved = res.unresolved.length > 0;
        if (!hasTracks && !hasUnresolved && res.skipped === 0) {
          setM3uImportSummary({
            imported: 0,
            unresolved: 0,
            skipped: 0,
            unresolvedHint: undefined,
            error: "No playable local tracks under your music folder were listed in this file.",
          });
          setM3uYoutubeResolveContext(null);
          return;
        }
        if (!hasTracks && !hasUnresolved && res.skipped > 0) {
          setM3uImportSummary({
            imported: 0,
            unresolved: 0,
            skipped: res.skipped,
            unresolvedHint: undefined,
            error: "All listed tracks were skipped (outside music folder, missing, or not audio).",
          });
          setM3uYoutubeResolveContext(null);
          return;
        }
        const unified = await createUnifiedPlaylistFromLocalScan(
          {
            playlistName: res.playlistName,
            files: res.files,
            trackDisplayNames: res.trackDisplayNames,
            ...(!hasTracks ? { playlistSourcePath: trimmed } : {}),
          },
          defaultGenre,
        );
        if (!unified) {
          setM3uImportSummary({
            imported: res.imported,
            unresolved: res.unresolved.length,
            skipped: res.skipped,
            unresolvedHint: unresolvedM3uSummaryHint(res.unresolved),
            error: "Could not save playlist. Check your connection and try again.",
          });
          setM3uYoutubeResolveContext(null);
          return;
        }
        onAddToLibrary(unified);
        setM3uImportSummary({
          imported: res.imported,
          unresolved: res.unresolved.length,
          skipped: res.skipped,
          unresolvedHint: unresolvedM3uSummaryHint(res.unresolved),
        });
        setM3uYoutubeResolveContext(buildM3uYoutubeResolveContext(unified, res));
      } catch (e) {
        setM3uImportSummary({
          imported: 0,
          unresolved: 0,
          skipped: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setM3uImportBusy(false);
      }
    },
    [defaultGenre, onAddToLibrary, rootPath],
  );

  const notifyYoutubePlaylistMerged = useCallback(
    (u: UnifiedSource) => {
      onPlaylistUpdated?.(u);
    },
    [onPlaylistUpdated],
  );

  const handleYoutubeResolveApplied = useCallback((mergedOrders: readonly number[]) => {
    setYoutubeResolveOpen(false);
    setM3uYoutubeResolveContext(null);
    const mergedCount = mergedOrders.length;
    setM3uImportSummary((prev) => {
      if (!prev || mergedCount <= 0) return prev;
      const nextUnresolved = Math.max(0, prev.unresolved - mergedCount);
      return {
        ...prev,
        unresolved: nextUnresolved,
        unresolvedHint: nextUnresolved > 0 ? prev.unresolvedHint : undefined,
      };
    });
  }, []);

  const onM3uFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      const p = getNativePathForDroppedFile(f);
      if (p) void runM3uImport(p);
    },
    [runM3uImport],
  );

  useEffect(() => {
    if (!addModalTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !addFlowBusy) resetAddModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addModalTarget, addFlowBusy, resetAddModal]);

  const webOnly = !isElectronWithBridge();
  const listApiMissing = isElectronWithBridge() && !canListMusicLibrary();

  return (
    /* 2026-11-10 (owner): drawn straight on the library page in Ori's language — no panel box, no frames inside frames; colours from
       app/center-panels.css (`sb-cp`) so the dark / transparent / white looks all apply. Behaviour unchanged. */
    <div className="sb-cp sb-anim-rise flex h-full min-h-0 flex-col gap-4 px-1 pb-1">
      <header className="flex shrink-0 items-center justify-between gap-4 pt-1">
        <div className="min-w-0">
          <h2 className="sb-cp-title">My Computer</h2>
          <p className="sb-cp-meta mt-1">Music files on this PC · they stay on this computer</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="sb-cp-icon-btn">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      {webOnly ? (
        <div className="flex flex-col items-start gap-1 py-6">
          <p className="sb-cp-ink text-base font-semibold">Available in SyncBiz Desktop</p>
          <p className="sb-cp-2 max-w-md text-sm leading-relaxed">Local folder browsing runs in the desktop app on your PC.</p>
          <div className="mt-4 flex items-center gap-2">
            <a href="/api/desktop/download" className="sb-cp-primary">
              Download Desktop
            </a>
            <Link href="/settings" className="sb-cp-act">
              Open Settings
            </Link>
          </div>
        </div>
      ) : listApiMissing ? (
        <p className="sb-cp-2 py-6 text-sm leading-relaxed">Update SyncBiz Desktop to browse your music folder.</p>
      ) : !rootPath ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
          <span className="sb-cp-glyph mb-5">
            <IconFolderGlyph className="h-7 w-7" />
          </span>
          <p className="sb-cp-ink max-w-sm text-lg font-semibold sm:text-xl">No music folder selected</p>
          <p className="sb-cp-2 mt-2 max-w-md text-sm leading-relaxed">
            Choose where your local audio files live. You can change it anytime in Settings.
          </p>
          {canPickMusicFolder() ? (
            <button
              type="button"
              disabled={folderPickBusy}
              onClick={() => void chooseMusicFolderFromPanel()}
              className="sb-cp-primary mt-7"
            >
              {folderPickBusy ? "Opening…" : "Choose Music Folder"}
            </button>
          ) : (
            <p className="sb-cp-2 mt-4 max-w-md text-xs">Update SyncBiz Desktop to choose a folder from here, or use Settings below.</p>
          )}
          <Link href="/settings" className={`sb-cp-act ${canPickMusicFolder() ? "mt-3" : "mt-5"}`}>
            Open Settings
          </Link>
          {folderPickError ? <p className="mt-3 max-w-md text-xs text-rose-400">{folderPickError}</p> : null}
        </div>
      ) : (
        <div
          className={`flex min-h-0 flex-1 flex-col gap-3 ${m3uDropHighlight ? "rounded-lg ring-2 ring-cyan-500/45 ring-inset" : ""}`}
          onDragEnter={(e) => {
            if (!canImportM3u() || m3uImportBusy) return;
            e.preventDefault();
            m3uDragDepthRef.current += 1;
            setM3uDropHighlight(true);
          }}
          onDragLeave={() => {
            m3uDragDepthRef.current = Math.max(0, m3uDragDepthRef.current - 1);
            if (m3uDragDepthRef.current === 0) setM3uDropHighlight(false);
          }}
          onDragOver={(e) => {
            if (!canImportM3u() || m3uImportBusy) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            m3uDragDepthRef.current = 0;
            setM3uDropHighlight(false);
            e.preventDefault();
            if (!canImportM3u() || m3uImportBusy) return;
            const playlistPath = getPlaylistContainerPathFromDataTransfer(e.dataTransfer);
            if (playlistPath) {
              e.stopPropagation();
              void runM3uImport(playlistPath);
            }
          }}
        >
          <input
            ref={m3uFileInputRef}
            type="file"
            accept=".m3u,.m3u8,.pls,application/vnd.apple.mpegurl,audio/mpegurl"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={onM3uFileInputChange}
          />
          {/* path bar: quiet Up / Import + the folder trail as plain words (no boxes) */}
          <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
            <button type="button" disabled={!segments.length} onClick={navigateUp} className="sb-cp-act -ms-2">
              <IconChevronLeft className="h-4 w-4 rtl:rotate-180" />
              Up
            </button>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 px-1 text-[13px] font-semibold">
              {segments.length === 0 ? (
                <button type="button" onClick={() => navigateToSegment(-1)} className="sb-cp-ink break-all text-start">
                  {/* Folder NAME only (no drive/location) — customer privacy. */}
                  {(rootPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Library")}
                </button>
              ) : (
                <>
                  <button type="button" className="sb-cp-2 shrink-0 hover:underline" onClick={() => navigateToSegment(-1)}>
                    Root
                  </button>
                  {segments.map((seg, i) => (
                    <span key={`${seg}-${i}`} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                      <span className="sb-cp-faint" aria-hidden>
                        /
                      </span>
                      <button
                        type="button"
                        className={`min-w-0 max-w-full break-all text-start ${i === segments.length - 1 ? "sb-cp-ink" : "sb-cp-2 hover:underline"}`}
                        onClick={() => navigateToSegment(i)}
                      >
                        {seg}
                      </button>
                    </span>
                  ))}
                </>
              )}
            </div>
            {canImportM3u() ? (
              <button
                type="button"
                disabled={m3uImportBusy || addFlowBusy}
                onClick={() => m3uFileInputRef.current?.click()}
                className="sb-cp-act"
              >
                {m3uImportBusy ? "Importing…" : "Import playlist"}
              </button>
            ) : null}
          </nav>

          {m3uImportSummary ? (
            <div className="sb-cp-soft sb-cp-ink px-3 py-2.5 text-sm" role="status">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 leading-relaxed">
                  <span className="font-semibold">Playlist import:</span> {m3uImportSummary.imported} imported
                  {m3uImportSummary.unresolved > 0
                    ? ` · ${m3uImportSummary.unresolved} unresolved`
                    : ""}
                  {m3uImportSummary.skipped > 0 ? ` · ${m3uImportSummary.skipped} skipped (duplicates)` : ""}
                  {m3uImportSummary.error ? (
                    <span className="mt-1 block text-xs text-rose-400">{m3uImportSummary.error}</span>
                  ) : null}
                  {m3uImportSummary.unresolvedHint ? (
                    <span className="sb-cp-2 mt-1 block font-mono text-[11px] leading-snug">
                      Unresolved query: {m3uImportSummary.unresolvedHint}
                    </span>
                  ) : null}
                </p>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {m3uYoutubeResolveContext && m3uImportSummary.unresolved > 0 && !m3uImportSummary.error ? (
                    <button
                      type="button"
                      disabled={m3uImportBusy}
                      onClick={() => setYoutubeResolveOpen(true)}
                      className="rounded-lg bg-gradient-to-b from-[#1ed760]/90 to-[#1db954]/90 px-3 py-1.5 text-xs font-semibold shadow-[0_0_0_1px_rgba(29,185,84,0.35)] transition hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
                      style={{ color: "#ffffff" }}
                    >
                      Find missing on YouTube
                    </button>
                  ) : null}
                  <button type="button" className="sb-cp-act !py-1 !text-xs" onClick={() => setM3uImportSummary(null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ) : m3uYoutubeResolveContext?.unresolvedRows.length ? (
            <div className="sb-cp-soft flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span className="sb-cp-ink">
                {m3uYoutubeResolveContext.playlistName}
                <span className="sb-cp-faint ms-2 font-mono text-xs">
                  ({m3uYoutubeResolveContext.unresolvedRows.length} unresolved)
                </span>
              </span>
              <button
                type="button"
                disabled={m3uImportBusy}
                onClick={() => setYoutubeResolveOpen(true)}
                className="shrink-0 rounded-lg bg-gradient-to-b from-[#1ed760]/90 to-[#1db954]/90 px-3 py-1.5 text-xs font-semibold shadow-[0_0_0_1px_rgba(29,185,84,0.35)] hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
                      style={{ color: "#ffffff" }}
              >
                Find missing on YouTube
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto pe-1">
            {listLoading || list === null ? (
              <p className="sb-cp-faint p-8 text-center text-sm font-medium">Loading…</p>
            ) : list.status === "error" ? (
              <p className="p-8 text-center text-sm text-rose-400">{list.message}</p>
            ) : list.status === "no_root" ? (
              <p className="sb-cp-faint p-8 text-center text-sm">Could not read folder.</p>
            ) : list.dirs.length === 0 && list.files.length === 0 ? (
              <p className="sb-cp-faint p-8 text-center text-sm font-medium">Empty folder.</p>
            ) : (
              <div className="space-y-7 pb-2">
                {list.dirs.length > 0 ? (
                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="sb-cp-section">Folders</h3>
                      <span className="sb-cp-meta tabular-nums">{list.dirs.length}</span>
                    </div>
                    {/* a folder = one row like the library's "Contributors" row: glyph · name · meta · quiet actions — no card, no inner frame */}
                    <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
                      {list.dirs.map((d) => (
                        <article key={d.path} className="sb-cp-row sb-cp-hit flex items-center gap-1 pe-1.5">
                          <div
                            role="button"
                            tabIndex={0}
                            draggable
                            onDragStart={(e) => setMusicLibraryDragData(e.dataTransfer, { kind: "folder", path: d.path })}
                            onClick={() => setRelSubpath([...segments, d.name].join("/"))}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                setRelSubpath([...segments, d.name].join("/"));
                              }
                            }}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 p-2 outline-none active:cursor-grabbing"
                          >
                            <span className="sb-cp-glyph">
                              <IconFolderGlyph className="h-6 w-6" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="sb-cp-ink sb-cp-clip block text-[15px] font-semibold">{d.name}</span>
                              <span className="sb-cp-faint mt-0.5 block text-[11px]">Folder</span>
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={scanBusy === d.path || addFlowBusy}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              openAddModal({ kind: "folder", path: d.path, defaultName: d.name });
                            }}
                            aria-label={`Add ${d.name} to a playlist`}
                            className="sb-cp-icon-btn"
                          >
                            <IconPlus className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(scanBusy)}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void scanAndPlayFolder(d.path);
                            }}
                            aria-label={`Play ${d.name}`}
                            className="sb-cp-icon-btn"
                          >
                            {scanBusy === d.path ? <span className="text-xs">…</span> : <IconPlay className="h-4 w-4" />}
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {list.files.length > 0 ? (
                  <section className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="sb-cp-section">Tracks</h3>
                      <span className="sb-cp-meta text-[11px]">
                        {list.files.length} track{list.files.length === 1 ? "" : "s"} · double-click to play
                      </span>
                    </div>
                    <div>
                      <TrackTable
                        files={list.files}
                        scanBusyPath={scanBusy}
                        addFlowBusy={addFlowBusy}
                        onPlay={(p) => void playTrackInCurrentBrowseFolder(p)}
                        onAddToPlaylist={(f) =>
                          openAddModal({ kind: "file", path: f.path, defaultName: f.name.replace(/\.[^/.]+$/, "") })
                        }
                        onDragStartFile={(e, p) => setMusicLibraryDragData(e.dataTransfer, { kind: "file", path: p })}
                      />
                    </div>
                  </section>
                ) : null}
              </div>
            )}
          </div>
          <p className="sb-cp-faint text-center text-[11px]">
            Drag to player or Drop Next: temporary playback only · Add to Playlist saves to your library · files stay local
            {canImportM3u()
              ? " · Drop .m3u / .m3u8 / .pls here to import (tracks must be under your music folder)"
              : ""}
          </p>
        </div>
      )}

      {/* The two pop-up dialogs stay dark cards in every look. `contents` draws no box; the class pair is the one app/white-look.css already
          leaves alone (`.sb-anim-rise[class*="bg-slate-950"]`), so the white look does not turn their light text dark on their dark card. */}
      <div className="sb-anim-rise bg-slate-950 contents">
      {addModalTarget ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !addFlowBusy) resetAddModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mml-add-title"
            className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-700/90 bg-slate-950 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-800/80 px-4 py-3">
              <h3 id="mml-add-title" className="text-sm font-semibold tracking-tight text-slate-100">
                Add to Playlist
              </h3>
              <p className="mt-0.5 truncate text-xs text-slate-500" title={addModalTarget.defaultName}>
                {addModalTarget.kind === "folder" ? "Folder" : "File"} · {addModalTarget.defaultName}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {addFeedback.phase === "loading" ? (
                <p className="py-6 text-center text-sm font-medium text-sky-200/90">{addFeedback.message}</p>
              ) : addFeedback.phase === "ok" ? (
                <div className="space-y-3 py-1">
                  <p className="text-sm leading-relaxed text-emerald-200/95">{addFeedback.message}</p>
                  <button
                    type="button"
                    onClick={resetAddModal}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-500 hover:bg-slate-800"
                  >
                    Done
                  </button>
                </div>
              ) : addFeedback.phase === "error" ? (
                <div className="space-y-3 py-1">
                  <p className="text-sm leading-relaxed text-rose-300/95">{addFeedback.message}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={addFlowBusy}
                      onClick={() => {
                        setAddFeedback({ phase: "idle" });
                        setAddModalStep("menu");
                      }}
                      className="flex-1 rounded-lg border border-slate-600 bg-slate-900 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={addFlowBusy}
                      onClick={resetAddModal}
                      className="flex-1 rounded-lg border border-slate-700 py-2 text-xs font-semibold text-slate-400 transition hover:text-slate-200 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : addModalStep === "menu" ? (
                <div className="flex flex-col gap-2.5">
                  {!hasUserPlaylists ? (
                    <p className="rounded-lg border border-slate-800/90 bg-slate-900/40 px-3 py-2 text-xs leading-relaxed text-slate-400">
                      No saved playlists yet. Use <span className="font-semibold text-slate-300">Create new playlist</span>{" "}
                      to add one to your library.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={addFlowBusy}
                    onClick={() => {
                      setAddModalStep("create");
                      setCreateNameDraft(addModalTarget.defaultName);
                      setAddFeedback({ phase: "idle" });
                    }}
                    className="rounded-lg border border-cyan-500/35 bg-cyan-950/30 px-3 py-2.5 text-left text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/50 hover:bg-cyan-900/25 disabled:opacity-50"
                  >
                    Create new playlist
                    <span className="mt-0.5 block text-[11px] font-normal text-cyan-200/60">
                      Save as a new library playlist (name editable)
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!hasUserPlaylists || addFlowBusy}
                    onClick={() => {
                      setAddModalStep("existing");
                      setPickedPlaylistKey(null);
                      setAddFeedback({ phase: "idle" });
                    }}
                    className="rounded-lg border border-slate-600/60 bg-slate-900/50 px-3 py-2.5 text-left text-sm font-semibold text-slate-100 transition enabled:hover:border-slate-500 enabled:hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Add to existing playlist
                    <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                      Append local tracks to a playlist you already have
                    </span>
                  </button>
                </div>
              ) : addModalStep === "create" ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="mml-new-pl-name" className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                      Playlist name
                    </label>
                    <input
                      id="mml-new-pl-name"
                      type="text"
                      value={createNameDraft}
                      onChange={(e) => setCreateNameDraft(e.target.value)}
                      disabled={addFlowBusy}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-600 focus:border-sky-500/50 disabled:opacity-50"
                      placeholder={addModalTarget.defaultName}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={addFlowBusy}
                      onClick={() => {
                        setAddModalStep("menu");
                        setAddFeedback({ phase: "idle" });
                      }}
                      className="flex-1 rounded-lg border border-slate-600 bg-slate-900 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={addFlowBusy}
                      onClick={() => void runCreateSavedPlaylist()}
                      className="flex-1 rounded-lg border border-sky-500/45 bg-sky-800/80 py-2 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
                    >
                      Create playlist
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[11px] text-slate-500">Select a playlist, then add tracks.</p>
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-800/80 bg-slate-950/50 p-1">
                    {userPlaylists.map((p) => (
                      <li key={p.key}>
                        <button
                          type="button"
                          disabled={addFlowBusy}
                          onClick={() => setPickedPlaylistKey(p.key)}
                          className={`w-full rounded-md px-2.5 py-2 text-left text-sm transition ${
                            pickedPlaylistKey === p.key
                              ? "bg-sky-900/35 text-sky-100 ring-1 ring-sky-500/40"
                              : "text-slate-200 hover:bg-slate-800/70"
                          } disabled:opacity-50`}
                        >
                          {p.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={addFlowBusy}
                      onClick={() => {
                        setAddModalStep("menu");
                        setPickedPlaylistKey(null);
                        setAddFeedback({ phase: "idle" });
                      }}
                      className="flex-1 rounded-lg border border-slate-600 bg-slate-900 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={addFlowBusy || !pickedPlaylistKey}
                      onClick={() => void runAppendToExistingPlaylist()}
                      className="flex-1 rounded-lg border border-sky-500/45 bg-sky-800/80 py-2 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-45"
                    >
                      Add tracks
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {youtubeResolveOpen && m3uYoutubeResolveContext ? (
        <M3uYoutubeResolveModal
          context={m3uYoutubeResolveContext}
          defaultGenre={defaultGenre}
          onClose={() => setYoutubeResolveOpen(false)}
          onPlaylistMerged={notifyYoutubePlaylistMerged}
          onApplied={handleYoutubeResolveApplied}
        />
      ) : null}
      </div>
    </div>
  );
}
