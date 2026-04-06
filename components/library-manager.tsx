"use client";

import { useState, useMemo } from "react";
import { LibraryPlaybackProvider, useLibraryPlayback } from "@/lib/library-playback-context";
import type { LibraryItem } from "@/lib/library-types";
import { getLibraryItemId, getLibraryItemName, getLibraryItemCover, isPlaylist } from "@/lib/library-types";
import { LibraryItemCard } from "@/components/library-item-card";
import { SyncBizPlayer } from "@/components/syncbiz-player";
import { AddPlaylistForm } from "@/components/add-playlist-form";
import { SharePlaylistModal } from "@/components/share-playlist-modal";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ViewMode = "grid" | "list";

type Props = {
  initialItems: LibraryItem[];
};

export function LibraryManager({ initialItems }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [genreFilter, setGenreFilter] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const playlists = initialItems.filter(isPlaylist).map((i) => i.data);
  const genres = [...new Set(playlists.map((p) => p.genre).filter(Boolean))].sort();

  const filtered = useMemo(() => {
    if (!genreFilter) return initialItems;
    return initialItems.filter((item) => {
      if (!isPlaylist(item)) return true;
      return item.data.genre?.toLowerCase() === genreFilter.toLowerCase();
    });
  }, [initialItems, genreFilter]);

  return (
    <LibraryPlaybackProvider items={filtered}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex rounded-xl border border-slate-800 bg-slate-900/60 p-0.5"
              role="tablist"
              aria-label="View mode"
            >
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "grid" ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "list" ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                List
              </button>
            </div>
            {genres.length > 0 && (
              <select
                value={genreFilter}
                onChange={(e) => setGenreFilter(e.target.value)}
                className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-200"
              >
                <option value="">All genres</option>
                {genres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
            <ShuffleToggle />
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              {showAddForm ? "Hide" : "Add playlist"}
            </button>
          </div>
        </div>

        {showAddForm && (
          <AddPlaylistForm
            onAdd={(p) => {
              window.location.reload();
            }}
          />
        )}

        <SyncBizPlayer />

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 py-16 text-center text-sm text-slate-500">
            No items in library. Add a playlist or create sources.
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((item, i) => (
              <LibraryItemCard key={getItemKey(item)} item={item} index={i} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 divide-y divide-slate-800/60 overflow-hidden">
            {filtered.map((item, i) => (
              <LibraryItemRow key={getItemKey(item)} item={item} index={i} />
            ))}
          </div>
        )}
      </div>
    </LibraryPlaybackProvider>
  );
}

function getItemKey(item: LibraryItem): string {
  return getLibraryItemId(item);
}

function ShuffleToggle() {
  const { shuffle, setShuffle } = useLibraryPlayback();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-400">
      <input
        type="checkbox"
        checked={shuffle}
        onChange={(e) => setShuffle(e.target.checked)}
        className="rounded border-slate-700"
      />
      Shuffle
    </label>
  );
}

function LibraryItemRow({ item, index }: { item: LibraryItem; index: number }) {
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const { playItem, isActive, stop, pause } = useLibraryPlayback();
  const active = isActive(item);
  const cover = getLibraryItemCover(item);
  const name = getLibraryItemName(item);

  const iconType = getIconType(item);
  const genre = isPlaylist(item) ? item.data.genre : null;

  return (
    <div
      className={`grid grid-cols-[auto,1fr,auto] gap-4 items-center px-4 py-3 hover:bg-slate-900/40 ${
        active ? "bg-slate-900/60 ring-1 ring-[#1db954]/30" : ""
      }`}
    >
      <div className="relative h-14 w-14 overflow-hidden rounded-lg bg-slate-800">
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <DefaultCover />
        )}
        <div className="absolute bottom-0 right-0 p-0.5">
          <SourceIcon type={iconType} size="sm" />
        </div>
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-100">{name}</p>
        {genre && <p className="text-xs text-slate-500">{genre}</p>}
      </div>
      <div className="flex items-center gap-2">
        {active && (
          <>
            <button onClick={stop} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800" title="Stop">
              ■
            </button>
            <button onClick={() => playItem(item)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1db954] text-white hover:bg-[#1ed760]">
              ▶
            </button>
            <button onClick={pause} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800" title="Pause">
              ⏸
            </button>
          </>
        )}
        {!active && (
          <button onClick={() => playItem(item)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1db954] text-white hover:bg-[#1ed760]">
            ▶
          </button>
        )}
        {isPlaylist(item) ? (
          <>
            <Link href={`/playlists/${item.data.id}/edit`} className="rounded-lg border border-slate-700/80 bg-slate-900/70 px-2 py-1 text-xs text-slate-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.2)] transition hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 hover:shadow-[0_0_12px_rgba(100,116,139,0.06)]">
              Edit
            </Link>
            <button onClick={() => setShareOpen(true)} className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800">
              Share
            </button>
            {shareOpen && (
              <SharePlaylistModal playlist={item.data} onClose={() => setShareOpen(false)} />
            )}
          </>
        ) : (
          <Link href={`/sources/${item.data.id}/edit`} className="rounded-lg border border-slate-700/80 bg-slate-900/70 px-2 py-1 text-xs text-slate-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.2)] transition hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 hover:shadow-[0_0_12px_rgba(100,116,139,0.06)]">
            Edit
          </Link>
        )}
      </div>
    </div>
  );
}

function DefaultCover() {
  return (
    <div className="flex h-full w-full items-center justify-center text-slate-500">
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

type IconType = "youtube" | "soundcloud" | "local" | "external";

function getIconType(item: LibraryItem): IconType {
  if (item.kind === "playlist") {
    const t = item.data.type;
    if (t === "youtube") return "youtube";
    if (t === "soundcloud") return "soundcloud";
    if (t === "local") return "local";
    return "external";
  }
  const url = (item.data.target ?? item.data.uriOrPath ?? "").toLowerCase();
  if (url.includes("youtube") || url.includes("youtu.be")) return "youtube";
  if (url.includes("soundcloud")) return "soundcloud";
  if (item.data.type === "local_playlist" || item.data.type === "app_target") return "local";
  return "external";
}

function SourceIcon({ type, size }: { type: IconType; size: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const color =
    type === "youtube" ? "text-[#ff0000]" : type === "soundcloud" ? "text-[#ff5500]" : "text-slate-300";
  return (
    <span className={`flex ${sizeClass} items-center justify-center rounded-lg bg-black/60 p-1 ${color}`}>
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
      {type === "local" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={sizeClass}>
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="12" y2="17" />
        </svg>
      )}
      {type === "external" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={sizeClass}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )}
    </span>
  );
}
