"use client";

import { useCallback, useMemo, useState, type DragEvent } from "react";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { LibrarySourceItemActions } from "@/components/library-source-item-actions";
import { LibraryBrowseRowSurface } from "@/components/player-surface/library-browse-row-surface";
import { ShareModal } from "@/components/share-modal";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { TrackMediaPlaceholder, inferTrackSourceChip } from "@/components/track-source-visual";
import { useLocale, useTranslations } from "@/lib/locale-context";
import {
  AI_PLAYLIST_GENRE,
  DJ_CREATOR_SAVED_GENRE,
  isDjCreatorAiWorkspacePlaylist,
  playlistGenreLabel,
} from "@/lib/dj-creator-playlist-scope";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { useSourcesPlayback } from "@/lib/sources-playback-context";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import type { UnifiedSource } from "@/lib/source-types";
import { removePlaylistFromLocal } from "@/lib/unified-sources-client";
import "@/components/player-surface/library-browse-card-surface.css";

/**
 * DJ Creator hub action tooltips. Hebrew labels override the global `t.editPlaylist`
 * so the icon button reads "ערוך פרטים" (Edit details) rather than the catalog-style
 * "ערוך פלייליסט" — keeping Open (track list) and Edit (metadata) visually distinct.
 */
function djCreatorDeckLabels(he: boolean) {
  return he
    ? {
        play: "נגן",
        edit: "ערוך פרטים",
        editPlaylist: "ערוך פרטים",
        share: "שתף",
        delete: "מחק",
      }
    : {
        play: "Play",
        edit: "Edit details",
        editPlaylist: "Edit details",
        share: "Share",
        delete: "Delete",
      };
}

/**
 * Compact "source" pill rendered on every AI playlist row.
 *
 * For pilot we surface two visual states:
 *   - "AI"           → playlist.genre === "AI Playlist" (auto-built by DJ Creator AI)
 *   - "DJ"           → playlist.genre === "DJ Creator"  (user-saved manual mix)
 *
 * The chip mirrors the "SINGLE" / "LIST" overlay convention used by
 * `source-card-unified.tsx` so users can scan AI vs. saved playlists at a
 * glance without opening them.
 */
function djCreatorSourceChip(source: UnifiedSource, he: boolean): { label: string; cls: string } | null {
  const tag = playlistGenreLabel(source);
  if (tag === AI_PLAYLIST_GENRE) {
    return {
      label: he ? "AI" : "AI",
      cls:
        "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    };
  }
  if (tag === DJ_CREATOR_SAVED_GENRE) {
    return {
      label: he ? "DJ" : "DJ",
      cls:
        "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30",
    };
  }
  return null;
}

/** Style/mood chips derived from optional playlist taxonomy fields. */
function djCreatorTaxonomyChips(source: UnifiedSource): string[] {
  const p = source.playlist;
  if (!p) return [];
  const out: string[] = [];
  const primary = (p.primaryGenre ?? "").trim();
  if (primary) out.push(primary);
  const mood = (p.mood ?? "").trim();
  if (mood) out.push(mood);
  for (const sg of p.subGenres ?? []) {
    const s = (sg ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 3) break;
  }
  return out.slice(0, 3);
}

/** Matches `ActionButtonShare` / `ActionButtonEdit` player variant in library deck rows. */
const PLAYER_DECK_LINK_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center select-none rounded-lg border-2 border-white/60 bg-slate-900/95 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_0_20px_rgba(255,255,255,0.15)] transition-all duration-200 hover:border-white hover:shadow-[0_0_0_2px_rgba(255,255,255,0.4),0_0_28px_rgba(255,255,255,0.25)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-slate-950";

type Props = {
  sources: UnifiedSource[];
  onSourcesChange: (updater: (prev: UnifiedSource[]) => UnifiedSource[]) => void;
  onDragStart?: (e: DragEvent<HTMLElement>, source: UnifiedSource) => void;
  /**
   * Open the playlist track list (NOT play). Hosted by the workspace so it can close
   * the DJ Creator hub and select the playlist in the library view. Used by
   * double-click and the row's "Open" button. Falls back to playSource when undefined
   * (legacy callers that haven't wired the new contract yet).
   */
  onOpenPlaylist?: (source: UnifiedSource) => void;
  /** When false, omit inner section heading (hub panel already has a title). */
  showSectionTitle?: boolean;
};

function DjCreatorPlaylistRow({
  source,
  onDragStart,
  onSourcesChange,
  onOpenPlaylist,
  he,
}: {
  source: UnifiedSource;
  onDragStart?: (e: DragEvent<HTMLElement>, source: UnifiedSource) => void;
  onSourcesChange: (updater: (prev: UnifiedSource[]) => UnifiedSource[]) => void;
  onOpenPlaylist?: (source: UnifiedSource) => void;
  he: boolean;
}) {
  const { t } = useTranslations();
  const { playSource, pause, stop, isActive } = useSourcesPlayback();
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deckLabels = useMemo(() => djCreatorDeckLabels(he), [he]);
  const openLabel = he ? "פתח פלייליסט" : "Open playlist";

  const active = isActive(source);
  const pid = source.playlist!.id!;
  const n = getPlaylistTracks(source.playlist!).length;
  const cover = source.cover?.trim() || null;
  const sourceChip = useMemo(() => djCreatorSourceChip(source, he), [source, he]);
  const taxonomyChips = useMemo(() => djCreatorTaxonomyChips(source), [source]);

  const handleOpen = useCallback(() => {
    if (onOpenPlaylist) onOpenPlaylist(source);
    else playSource(source);
  }, [onOpenPlaylist, playSource, source]);

  const executeDelete = useCallback(async () => {
    if (!source.playlist?.id) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(source.playlist.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(typeof data.error === "string" ? data.error : "Delete failed");
      }
      removePlaylistFromLocal(source.id);
      onSourcesChange((prev) => prev.filter((s) => s.id !== source.id));
      setDeleteOpen(false);
      window.dispatchEvent(new Event("library-updated"));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  }, [source, onSourcesChange]);

  return (
    <>
      <LibraryBrowseRowSurface
        variant="library"
        active={active}
        draggable={!!onDragStart}
        controlsGroupAriaLabel={t.sourceControlsAria}
        rowProps={{
          onDoubleClick: handleOpen,
          onDragStart: onDragStart ? (e) => onDragStart(e, source) : undefined,
        }}
        thumbSlot={
          <>
            {cover ? (
              <HydrationSafeImage src={cover} alt="" className="h-full w-full object-cover" draggable={false} />
            ) : (
              <TrackMediaPlaceholder
                chip={inferTrackSourceChip(source)}
                className="h-full w-full"
                showCornerBadge={false}
              />
            )}
            {/* Top-left source badge matches the "SINGLE" / "LIST" overlay style used by source-card-unified. */}
            {sourceChip ? (
              <span
                className={`pointer-events-none absolute left-1 top-1 z-10 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${sourceChip.cls}`}
                aria-label={
                  he
                    ? sourceChip.label === "AI"
                      ? "פלייליסט שנבנה על־ידי AI"
                      : "פלייליסט DJ Creator"
                    : sourceChip.label === "AI"
                    ? "AI-built playlist"
                    : "DJ Creator playlist"
                }
              >
                {sourceChip.label}
              </span>
            ) : null}
          </>
        }
        titleSlot={
          <span className="library-text-title font-medium tracking-tight leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
            {source.title}
          </span>
        }
        metaSlot={
          <div className="library-card-meta flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[color:var(--lib-text-secondary)]">
            <span className="tabular-nums">
              {he ? `${n} שירים` : `${n} ${n === 1 ? "track" : "tracks"}`}
            </span>
            {taxonomyChips.length > 0 ? (
              <span className="ml-1 flex flex-wrap items-center gap-1">
                {taxonomyChips.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center rounded-full bg-white/[0.06] px-2 py-[1px] text-[10px] font-medium uppercase tracking-[0.06em] text-slate-300 ring-1 ring-white/10"
                  >
                    {chip}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        }
        controlsSlot={
          <div className="flex flex-nowrap items-center justify-center gap-1">
            <LibrarySourceItemActions
              source={source}
              onPlay={() => playSource(source)}
              isActive={active}
              onStop={stop}
              onPause={pause}
              libraryDeckChrome
              compact
              deckActionLabels={deckLabels}
              onShareOpen={() => setShareOpen(true)}
              onDeletePress={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            />
            <button
              type="button"
              className={PLAYER_DECK_LINK_BTN}
              title={openLabel}
              aria-label={openLabel}
              onClick={(e) => {
                e.stopPropagation();
                handleOpen();
              }}
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          </div>
        }
      />

      {shareOpen ? (
        <ShareModal
          item={unifiedSourceToShareable(source)}
          fallbackPlaylistId={pid}
          onClose={() => setShareOpen(false)}
        />
      ) : null}

      <DeleteConfirmModal
        isOpen={deleteOpen}
        onClose={() => {
          if (deleteBusy) return;
          setDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => void executeDelete()}
        loading={deleteBusy}
        title={t.deletePlaylist}
        message={t.deletePlaylistConfirm}
        confirmLabel={t.confirmDelete}
        errorHint={deleteError}
      />
    </>
  );
}

export function DjCreatorAiPlaylistList({
  sources,
  onSourcesChange,
  onDragStart,
  onOpenPlaylist,
  showSectionTitle = true,
}: Props) {
  const { locale } = useLocale();
  const he = locale === "he";

  const rows = useMemo(() => {
    return sources
      .filter(isDjCreatorAiWorkspacePlaylist)
      .sort((a, b) => {
        const ca = a.playlist?.createdAt ?? "";
        const cb = b.playlist?.createdAt ?? "";
        return cb.localeCompare(ca);
      });
  }, [sources]);

  const empty = he
    ? "עדיין אין פלייליסטים — פתחו את העוזר ובנו פלייליסט חדש."
    : "No AI playlists yet — open the assistant and build a new playlist.";

  return (
    <div className={showSectionTitle ? "mt-4" : "mt-5"}>
      {showSectionTitle ? (
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {he ? "הפלייליסטים שלי" : "Your playlists"}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className={`text-sm text-slate-500 ${showSectionTitle ? "mt-2" : ""}`}>{empty}</p>
      ) : (
        <div
          className={`library-list-shell divide-y divide-[color:var(--lib-border-muted)] overflow-hidden rounded-2xl backdrop-blur-sm ${
            showSectionTitle ? "mt-2" : ""
          }`}
        >
          {rows.map((s) => (
            <DjCreatorPlaylistRow
              key={s.playlist!.id}
              source={s}
              onDragStart={onDragStart}
              onSourcesChange={onSourcesChange}
              onOpenPlaylist={onOpenPlaylist}
              he={he}
            />
          ))}
        </div>
      )}
    </div>
  );
}
