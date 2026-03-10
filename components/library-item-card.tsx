"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLibraryPlayback } from "@/lib/library-playback-context";
import {
  getLibraryItemName,
  getLibraryItemCover,
  isPlaylist,
} from "@/lib/library-types";
import type { LibraryItem } from "@/lib/library-types";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { SharePlaylistModal } from "@/components/share-playlist-modal";

type Props = {
  item: LibraryItem;
  index: number;
};

function DefaultCover() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-slate-500">
      <svg className="h-12 w-12 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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

function IconBadge({ type, size = "md" }: { type: IconType; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const containerClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const color =
    type === "youtube" ? "text-[#ff0000]" : type === "soundcloud" ? "text-[#ff5500]" : "text-slate-300";

  return (
    <span className={`flex ${containerClass} items-center justify-center rounded-xl bg-black/60 shadow-lg`} title={type}>
      {type === "youtube" && (
        <svg className={`${sizeClass} ${color}`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      )}
      {type === "soundcloud" && (
        <svg className={`${sizeClass} ${color}`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4.5c-1.5 0-2.8.5-3.9 1.2-.5.3-.9.7-1.1 1.2-.2-.1-.4-.1-.6-.1-1.1 0-2 .9-2 2v.1c-1.5.3-2.5 1.5-2.5 3 0 1.7 1.3 3 3 3h6.5c2.2 0 4-1.8 4-4 0-2.2-1.8-4-4-4-.2 0-.4 0-.6.1-.2-1.2-1.2-2.1-2.4-2.1z" />
        </svg>
      )}
      {type === "local" && (
        <svg className={`${sizeClass} ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="12" y2="17" />
        </svg>
      )}
      {type === "external" && (
        <svg className={`${sizeClass} ${color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )}
    </span>
  );
}

export function LibraryItemCard({ item, index }: Props) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const { playItem, isActive, stop, pause } = useLibraryPlayback();

  const active = isActive(item);
  const cover = getLibraryItemCover(item);
  const name = getLibraryItemName(item);
  const genre = isPlaylist(item) ? item.data.genre : null;
  const iconType = getIconType(item);

  async function handleDelete() {
    setDeleting(true);
    if (item.kind === "playlist") {
      const res = await fetch(`/api/playlists/${item.data.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } else {
      const res = await fetch(`/api/sources/${item.data.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    }
    setDeleting(false);
  }

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-2xl border bg-slate-950/60 transition-all hover:border-slate-700/80 hover:bg-slate-900/40 ${
        active ? "border-[#1db954]/50 ring-1 ring-[#1db954]/30" : "border-slate-800/80"
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-slate-900">
        {cover ? (
          <img
            src={cover}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        {!cover && <DefaultCover />}
        <div className="absolute bottom-2 right-2">
          <IconBadge type={iconType} size="md" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="truncate font-semibold text-slate-100">{name}</h3>
        {genre && <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{genre}</p>}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {active && (
            <>
              <button
                onClick={stop}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800"
                title="Stop"
              >
                ■
              </button>
              <button
                onClick={() => playItem(item)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#1db954] text-white transition hover:bg-[#1ed760]"
                title="Play"
              >
                ▶
              </button>
              <button
                onClick={pause}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800"
                title="Pause"
              >
                ⏸
              </button>
            </>
          )}
          {!active && (
            <button
              onClick={() => playItem(item)}
              className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#1db954] text-white transition hover:bg-[#1ed760]"
              title="Play"
            >
              <span className="text-lg">▶</span>
            </button>
          )}
          {isPlaylist(item) && (
            <>
              <Link
                href={`/playlists/${item.data.id}/edit`}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900/70 text-slate-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.2)] transition hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 hover:shadow-[0_0_12px_rgba(100,116,139,0.06)]"
                title="Edit"
              >
                ✎
              </Link>
              <button
                onClick={() => setShareOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-300"
                title="Share"
              >
                ↗
              </button>
            </>
          )}
          {item.kind === "source" && (
            <Link
              href={`/sources/${item.data.id}/edit`}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900/70 text-slate-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.2)] transition hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 hover:shadow-[0_0_12px_rgba(100,116,139,0.06)]"
              title="Edit"
            >
              ✎
            </Link>
          )}
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:border-rose-800/50 hover:bg-rose-950/30 hover:text-rose-400"
            title="Delete"
          >
            🗑
          </button>
        </div>
      </div>
      <DeleteConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        loading={deleting}
        message="Are you sure you want to delete this? This cannot be undone."
      />
      {isPlaylist(item) && shareOpen && (
        <SharePlaylistModal playlist={item.data} onClose={() => setShareOpen(false)} />
      )}
    </article>
  );
}
