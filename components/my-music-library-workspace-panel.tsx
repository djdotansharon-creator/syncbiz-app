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
  index,
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
  const zebra = index % 2 === 0 ? "bg-slate-900/30" : "bg-slate-900/15";

  return (
    <tr
      ref={rowRef}
      draggable
      onDragStart={(e) => onDragStartFile(e, file.path)}
      onDoubleClick={() => onPlay(file.path)}
      className={`${zebra} cursor-grab border-b border-slate-800/60 align-middle text-slate-200 transition hover:bg-slate-800/45 active:cursor-grabbing`}
    >
      <td className="px-3 py-2">
        <MusicLibraryTrackThumb absolutePath={file.path} />
      </td>
      <td className="max-w-[12rem] truncate px-3 py-2 text-sm" title={artist || undefined}>
        {artist || <span className="text-slate-600">—</span>}
      </td>
      <td className="max-w-[18rem] px-3 py-2 text-sm font-medium text-slate-100" title={titleShown}>
        <div className="truncate">{titleShown}</div>
        {!titleTagged ? (
          <div className="truncate font-mono text-[10px] text-slate-600" title={file.name}>
            {file.name}
          </div>
        ) : null}
      </td>
      <td className="max-w-[10rem] truncate px-3 py-2 text-xs capitalize text-slate-400" title={genre || undefined}>
        {genre || (showLoadingHint ? <span className="text-slate-600">…</span> : <span className="text-slate-700">—</span>)}
      </td>
      <td className="px-3 py-2 text-xs tabular-nums text-slate-400">
        {year || <span className="text-slate-700">—</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {process.env.NODE_ENV !== "production" ? (
            <button
              type="button"
              onClick={() => void inspectRawTagsAndLog(file.path)}
              title="Inspect raw tags (logs to console)"
              aria-label="Inspect raw tags"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-800/70 bg-slate-950/40 text-[10px] font-semibold text-slate-500 transition hover:border-slate-600 hover:bg-slate-800/60 hover:text-slate-200"
            >
              i
            </button>
          ) : null}
          <button
            type="button"
            disabled={isAddDisabled || isPlayBusy}
            onClick={() => onAddToPlaylist(file)}
            title="Add to Playlist"
            aria-label="Add to Playlist"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-700/70 bg-slate-900/60 text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-slate-100 disabled:pointer-events-none disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            disabled={isPlayBusy}
            onClick={() => onPlay(file.path)}
            className="inline-flex h-8 min-w-[3.5rem] items-center justify-center rounded-md border border-cyan-500/40 bg-cyan-900/35 px-2.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-400/55 hover:bg-cyan-800/40 disabled:pointer-events-none disabled:opacity-40"
          >
            {isPlayBusy ? "…" : "Play"}
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
      <table className="w-full min-w-[560px] table-auto border-collapse text-left">
        <thead className="sticky top-0 z-[1] bg-slate-950/95 backdrop-blur">
          <tr className="border-b border-slate-800/85 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {columns.map((c, i) => (
              <th key={`${c.label}-${i}`} className={`px-3 py-2 ${c.widthClass ?? ""} ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.key ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key as TrackSortKey)}
                    className="inline-flex items-center gap-1 text-slate-400 transition hover:text-slate-100"
                  >
                    {c.label}
                    <span className="text-[9px] text-slate-500">{sortIndicator(c.key as TrackSortKey)}</span>
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

const folderCardClass =
  "rounded-xl border border-slate-700/40 bg-slate-950/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]";

const ghostBtn =
  "inline-flex shrink-0 items-center justify-center rounded-md border border-slate-600/50 bg-slate-900/50 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800/60 hover:text-white disabled:pointer-events-none disabled:opacity-40";

const playOutlineBtn =
  "inline-flex shrink-0 items-center justify-center rounded-md border border-cyan-500/35 bg-cyan-950/35 px-3 py-1.5 text-[11px] font-semibold text-cyan-100/95 transition hover:border-cyan-400/45 hover:bg-cyan-900/35 disabled:pointer-events-none disabled:opacity-40";

const folderCardAccents = ["border-l-cyan-500/45", "border-l-sky-500/45", "border-l-teal-500/40", "border-l-violet-400/38"] as const;

function folderAccentClass(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h + path.charCodeAt(i) * (i + 3)) % 1009;
  return folderCardAccents[h % folderCardAccents.length] ?? folderCardAccents[0];
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
    <div className="sb-anim-rise flex h-full min-h-0 flex-col gap-4 bg-slate-950 p-4 sm:p-5">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800/70 pb-3">
        <h2 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">My Music Library</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700/75 bg-slate-900 text-slate-400 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/35"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {webOnly ? (
        <div className="rounded-xl border border-slate-800/85 bg-slate-900/50 p-6 text-slate-300">
          <p className="text-base font-semibold text-slate-100">Available in SyncBiz Desktop</p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
            Local folder browsing runs in the desktop app on your PC.
          </p>
          <a
            href="/api/desktop/download"
            className="mt-5 inline-flex items-center justify-center rounded-xl border border-sky-500/40 bg-sky-500/15 px-5 py-2.5 text-sm font-semibold text-sky-100 transition hover:border-sky-400/60 hover:bg-sky-500/25"
          >
            Download Desktop
          </a>
          <Link
            href="/settings"
            className="mt-4 inline-flex text-sm font-medium text-slate-400 underline decoration-slate-600 underline-offset-2 transition hover:text-slate-200"
          >
            Open Settings
          </Link>
        </div>
      ) : listApiMissing ? (
        <p className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-5 py-4 text-sm leading-relaxed text-amber-100/95">
          Update SyncBiz Desktop to browse your music folder.
        </p>
      ) : !rootPath ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/55 bg-slate-950 px-6 py-14 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-sky-500/20 bg-slate-900/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_16px_-2px_rgba(56,189,248,0.18)]">
            <IconFolderGlyph className="h-8 w-8 text-sky-400/85 drop-shadow-[0_0_6px_rgba(125,211,252,0.35)]" />
          </div>
          <p className="max-w-sm text-lg font-semibold tracking-tight text-slate-50 sm:text-xl">
            No music folder selected
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            Choose where your local audio files live. You can change it anytime in Settings.
          </p>
          {canPickMusicFolder() ? (
            <button
              type="button"
              disabled={folderPickBusy}
              onClick={() => void chooseMusicFolderFromPanel()}
              className="mt-7 inline-flex w-full max-w-xs items-center justify-center rounded-lg border border-sky-600/70 bg-sky-700 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50"
            >
              {folderPickBusy ? "Opening…" : "Choose Music Folder"}
            </button>
          ) : (
            <p className="mt-4 max-w-md text-xs text-amber-200/90">
              Update SyncBiz Desktop to choose a folder from here, or use Settings below.
            </p>
          )}
          <Link
            href="/settings"
            className={`inline-flex text-sm font-medium text-slate-400 underline decoration-slate-600 underline-offset-2 transition hover:text-slate-200 ${canPickMusicFolder() ? "mt-4" : "mt-6"}`}
          >
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
          <nav
            aria-label="Folder path"
            className="flex min-w-0 flex-col gap-2 border-b border-slate-800/75 pb-2 sm:flex-row sm:items-stretch sm:gap-3"
          >
            <button
              type="button"
              disabled={!segments.length}
              onClick={navigateUp}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs font-semibold text-slate-100 transition enabled:hover:border-slate-600 enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35 sm:self-auto"
            >
              <IconChevronLeft className="h-4 w-4 text-slate-400" />
              Up
            </button>
            {canImportM3u() ? (
              <button
                type="button"
                disabled={m3uImportBusy || addFlowBusy}
                onClick={() => m3uFileInputRef.current?.click()}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md border border-slate-700 bg-slate-900 px-2.5 text-xs font-semibold text-slate-100 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 sm:self-auto"
                title="Import .m3u / .m3u8 / .pls. Only tracks inside your music folder are added."
              >
                {m3uImportBusy ? "Importing…" : "Import playlist"}
              </button>
            ) : null}
            <div
              className="min-w-0 flex-1 rounded-md border border-slate-800/90 bg-slate-900/55 px-2.5 py-1.5"
              title={`${rootPath}${relSubpath ? `${rootPath.includes("\\") ? "\\" : "/"}${relSubpath.replace(/\//g, rootPath.includes("\\") ? "\\" : "/")}` : ""}`}
            >
              <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-slate-600">Location</p>
              <div className="mt-0.5 font-mono text-xs font-medium leading-snug text-slate-100 sm:text-[0.8125rem] sm:leading-snug">
                {segments.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => navigateToSegment(-1)}
                    className="break-all text-left text-sky-300/95 transition hover:text-sky-200"
                  >
                    {rootPath}
                  </button>
                ) : (
                  <span className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                    <button
                      type="button"
                      className="shrink-0 text-sky-300/95 transition hover:text-sky-200"
                      onClick={() => navigateToSegment(-1)}
                    >
                      Root
                    </button>
                    {segments.map((seg, i) => (
                      <span key={`${seg}-${i}`} className="flex min-w-0 flex-wrap items-baseline gap-x-1">
                        <span className="text-slate-600" aria-hidden>
                          /
                        </span>
                        <button
                          type="button"
                          className={`min-w-0 max-w-full break-all text-left ${
                            i === segments.length - 1 ? "text-slate-100" : "text-sky-300/95 hover:text-sky-200"
                          } transition`}
                          onClick={() => navigateToSegment(i)}
                        >
                          {seg}
                        </button>
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
          </nav>

          {m3uImportSummary ? (
            <div
              className={`rounded-lg border px-3 py-2.5 text-sm ${
                m3uImportSummary.error
                  ? "border-rose-500/35 bg-rose-500/[0.06] text-rose-100/95"
                  : "border-cyan-500/30 bg-cyan-500/[0.07] text-cyan-50/95"
              }`}
              role="status"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 leading-relaxed">
                  <span className="font-semibold">Playlist import:</span> {m3uImportSummary.imported} imported
                  {m3uImportSummary.unresolved > 0
                    ? ` · ${m3uImportSummary.unresolved} unresolved`
                    : ""}
                  {m3uImportSummary.skipped > 0 ? ` · ${m3uImportSummary.skipped} skipped (duplicates)` : ""}
                  {m3uImportSummary.error ? (
                    <span className="mt-1 block text-xs opacity-95">{m3uImportSummary.error}</span>
                  ) : null}
                  {m3uImportSummary.unresolvedHint ? (
                    <span
                      className={`mt-1 block font-mono text-[11px] leading-snug ${
                        m3uImportSummary.error ? "text-rose-100/75" : "text-cyan-100/70"
                      }`}
                    >
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
                      className="rounded-lg bg-gradient-to-b from-[#1ed760]/90 to-[#1db954]/90 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)] transition hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
                    >
                      Find missing on YouTube
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/90 hover:bg-white/10"
                    onClick={() => setM3uImportSummary(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ) : m3uYoutubeResolveContext?.unresolvedRows.length ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/85 bg-slate-900/50 px-3 py-2.5 text-sm">
              <span className="text-slate-300">
                {m3uYoutubeResolveContext.playlistName}
                <span className="ml-2 font-mono text-xs text-slate-500">
                  ({m3uYoutubeResolveContext.unresolvedRows.length} unresolved)
                </span>
              </span>
              <button
                type="button"
                disabled={m3uImportBusy}
                onClick={() => setYoutubeResolveOpen(true)}
                className="shrink-0 rounded-lg bg-gradient-to-b from-[#1ed760]/90 to-[#1db954]/90 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)] hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
              >
                Find missing on YouTube
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-800/90 bg-slate-950">
            {listLoading || list === null ? (
              <p className="p-8 text-center text-sm font-medium text-slate-500">Loading…</p>
            ) : list.status === "error" ? (
              <p className="p-8 text-center text-sm text-rose-400">{list.message}</p>
            ) : list.status === "no_root" ? (
              <p className="p-8 text-center text-sm text-slate-500">Could not read folder.</p>
            ) : list.dirs.length === 0 && list.files.length === 0 ? (
              <p className="p-8 text-center text-sm font-medium text-slate-500">Empty folder.</p>
            ) : (
              <div className="p-3 sm:p-4">
                {list.dirs.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {list.dirs.map((d) => (
                      <article
                        key={d.path}
                        className={`${folderCardClass} overflow-hidden border-l-[3px] ${folderAccentClass(d.path)}`}
                      >
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
                          className="cursor-pointer px-5 pb-4 pt-5 outline-none transition-colors hover:bg-slate-900/40 active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/35"
                        >
                          <div className="flex gap-4">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-sky-500/22 bg-slate-900/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_14px_-2px_rgba(56,189,248,0.22)]">
                              <IconFolderGlyph className="h-8 w-8 text-sky-300/90 drop-shadow-[0_0_7px_rgba(125,211,252,0.4)]" />
                            </div>
                            <div className="min-w-0 flex-1 pt-1">
                              <p className="text-lg font-semibold leading-snug tracking-tight text-slate-50 sm:text-xl">
                                {d.name}
                              </p>
                              <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
                                Folder · tap to open
                              </p>
                            </div>
                          </div>
                        </div>
                        <div
                          className="flex flex-wrap gap-1.5 border-t border-slate-800/80 px-5 py-2.5"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={scanBusy === d.path || addFlowBusy}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              openAddModal({ kind: "folder", path: d.path, defaultName: d.name });
                            }}
                            className={ghostBtn}
                          >
                            Add to Playlist
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(scanBusy)}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              void scanAndPlayFolder(d.path);
                            }}
                            className={playOutlineBtn}
                          >
                            {scanBusy === d.path ? "…" : "Play"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                {list.files.length > 0 ? (
                  <div className={list.dirs.length > 0 ? "mt-6" : ""}>
                    <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Tracks</p>
                      <p className="text-[10px] font-medium text-slate-600">
                        {list.files.length} track{list.files.length === 1 ? "" : "s"} · double-click to play
                      </p>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-slate-800/85 bg-slate-950/65">
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
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <p className="text-center text-[11px] text-slate-600">
            Drag to player or Drop Next: temporary playback only · Add to Playlist saves to your library · files stay local
            {canImportM3u()
              ? " · Drop .m3u / .m3u8 / .pls here to import (tracks must be under your music folder)"
              : ""}
          </p>
        </div>
      )}

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
  );
}
