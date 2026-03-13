"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { ActionButtonEdit, ActionButtonShare } from "@/components/ui/action-buttons";
import { RadioIcon } from "@/components/ui/radio-icon";
import { isValidStreamUrl } from "@/lib/url-validation";
import { formatViewCount, formatDuration } from "@/lib/format-utils";
import type { UnifiedSource } from "@/lib/source-types";

type Props = {
  source: UnifiedSource;
  onRemove: (id: string) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
};

function SourceLogo({ type, origin, size = "md" }: { type: UnifiedSource["type"]; origin?: UnifiedSource["origin"]; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const boxClass = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  const color =
    type === "youtube" ? "text-[#ff0000]" : type === "soundcloud" ? "text-[#ff5500]" : type === "spotify" ? "text-[#1db954]" : "text-slate-300";
  if (origin === "radio") {
    return (
      <span className={`flex ${boxClass} items-center justify-center rounded-lg bg-black/70 shadow-[0_2px_6px_rgba(0,0,0,0.4)] ring-1 ring-black/30 text-rose-400`} title="Radio">
        <RadioIcon className={sizeClass} />
      </span>
    );
  }
  return (
    <span className={`flex ${boxClass} items-center justify-center rounded-lg bg-black/70 shadow-[0_2px_6px_rgba(0,0,0,0.4)] ring-1 ring-black/30 ${color}`} title={type}>
      {type === "youtube" && (
        <svg className={sizeClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      )}
      {type === "soundcloud" && (
        <svg className={sizeClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4.5c-1.5 0-2.8.5-3.9 1.2-.5.3-.9.7-1.1 1.2-.2-.1-.4-.1-.6-.1-1.1 0-2 .9-2 2v.1c-1.5.3-2.5 1.5-2.5 3 0 1.7 1.3 3 3 3h6.5c2.2 0 4-1.8 4-4 0-2.2-1.8-4-4-4-.2 0-.4 0-.6.1-.2-1.2-1.2-2.1-2.4-2.1z" />
        </svg>
      )}
      {type === "spotify" && (
        <svg className={sizeClass} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02z" />
        </svg>
      )}
      {(type === "local" || type === "winamp" || type === "stream-url") && (
        <svg className={sizeClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="12" y2="17" />
        </svg>
      )}
    </span>
  );
}

export function SourceCard({ source, onRemove, isFavorite, onToggleFavorite, draggable, onDragStart }: Props) {
  const router = useRouter();
  const { t } = useTranslations();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mounted, setMounted] = useState(false);

  const { playSource, stop, pause, currentSource } = usePlayback();
  const active = mounted && currentSource?.id === source.id;

  useEffect(() => {
    setMounted(true);
  }, []);
  const hasInvalidUrl = source.origin === "radio" && source.radio && !isValidStreamUrl(source.radio.url);

  async function handleDelete() {
    setDeleting(true);
    try {
      if (source.origin === "playlist" && source.playlist) {
        const res = await fetch(`/api/playlists/${source.playlist.id}`, { method: "DELETE" });
        if (res.ok) {
          onRemove(source.id);
          router.refresh();
        }
      } else if (source.origin === "source" && source.source) {
        const res = await fetch(`/api/sources/${source.source.id}`, { method: "DELETE" });
        if (res.ok) {
          onRemove(source.id);
          router.refresh();
        }
      } else if (source.origin === "radio" && source.radio) {
        const res = await fetch(`/api/radio/${source.radio.id}`, { method: "DELETE" });
        if (res.ok) {
          onRemove(source.id);
          router.refresh();
        }
      }
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      className={`flex flex-col overflow-hidden rounded-xl border bg-slate-950/60 backdrop-blur-sm transition-all hover:border-slate-600/70 hover:bg-slate-900/50 hover:shadow-[0_0_20px_rgba(30,215,96,0.08)] ${
        active ? "playing-active border-[#1ed760]/40 shadow-[0_0_24px_rgba(30,215,96,0.12)]" : "border-slate-800/80"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900">
        {source.cover ? (
          <>
            <HydrationSafeImage src={source.cover} alt="" className="h-full w-full object-cover" />
            {source.origin === "radio" && (
              <span className="absolute top-2 right-2 rounded bg-rose-500/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-sm">
                {t.live ?? "LIVE"}
              </span>
            )}
          </>
        ) : null}
        {hasInvalidUrl && (
          <div
            className="absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/90 text-slate-900"
            title="Invalid URL – edit to fix"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              <line x1="12" y1="9" x2="12" y2="13" />
            </svg>
          </div>
        )}
        {!source.cover && (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-slate-500">
            <svg className="h-14 w-14 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-1.5">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{source.title}</h3>
          <div className="flex items-center gap-1">
            {onToggleFavorite && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
                className={`rounded p-0.5 transition-colors hover:bg-slate-700/60 ${isFavorite ? "text-amber-400" : "text-slate-500 hover:text-amber-400/70"}`}
                title={isFavorite ? t.removeFromFavorites : t.addToFavorites}
                aria-label={isFavorite ? t.removeFromFavorites : t.addToFavorites}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            )}
            <SourceLogo type={source.type} origin={source.origin} size="md" />
          </div>
        </div>
        {(source.genre || (source.viewCount ?? source.playlist?.viewCount) != null || (source.playlist?.durationSeconds ?? 0) > 0) && (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between gap-2">
              {source.genre && (
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{source.genre}</p>
              )}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 tabular-nums">
                {(source.viewCount ?? source.playlist?.viewCount) != null && (
                  <span>{formatViewCount(source.viewCount ?? source.playlist?.viewCount ?? 0)} {t.views ?? "views"}</span>
                )}
                {(source.viewCount ?? source.playlist?.viewCount) != null && (source.playlist?.durationSeconds ?? 0) > 0 && (
                  <span className="text-slate-600">•</span>
                )}
                {(source.playlist?.durationSeconds ?? 0) > 0 && (
                  <span>{formatDuration(source.playlist?.durationSeconds ?? 0)}</span>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="mt-1 flex w-full min-w-0 flex-wrap items-center justify-center gap-1.5" role="group" aria-label="Source controls">
          {active && (
            <>
              <NeonControlButton onClick={stop} size="sm" title="Stop" aria-label="Stop">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h12v12H6z" />
                </svg>
              </NeonControlButton>
              <NeonControlButton onClick={() => playSource(source)} size="md" active title="Play" aria-label="Play">
                <svg className="h-4 w-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7L8 5z" />
                </svg>
              </NeonControlButton>
              <NeonControlButton onClick={pause} size="sm" active title="Pause" aria-label="Pause">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              </NeonControlButton>
            </>
          )}
          {!active && (
            <NeonControlButton onClick={() => playSource(source)} size="md" title="Play" aria-label="Play">
              <svg className="h-4 w-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7L8 5z" />
              </svg>
            </NeonControlButton>
          )}
          {source.origin === "playlist" && source.playlist && (
            <ActionButtonEdit href={`/playlists/${source.playlist.id}/edit`} variant="player" title="Edit playlist" aria-label="Edit playlist" />
          )}
          {source.origin === "radio" && source.radio && (
            <ActionButtonEdit href={`/radio/${source.radio.id}/edit`} variant="player" title="Edit station" aria-label="Edit station" />
          )}
          {source.origin === "source" && source.source && (
            <ActionButtonEdit href={`/sources/${source.source.id}/edit`} variant="player" title="Edit" aria-label="Edit" />
          )}
          <ActionButtonShare variant="player" onClick={() => setShareOpen(true)} title={t.share} aria-label={t.share} />
          <NeonControlButton variant="red" size="sm" onClick={() => setDeleteOpen(true)} title={t.deletePlaylist} aria-label={t.deletePlaylist}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </NeonControlButton>
        </div>
      </div>
      <DeleteConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} loading={deleting} message={t.deleteSourceConfirm} />
      {shareOpen && (
        <ShareModal
          item={unifiedSourceToShareable(source)}
          fallbackPlaylistId={source.origin === "playlist" ? source.id : undefined}
          fallbackRadioId={source.origin === "radio" && source.radio ? source.radio.id : undefined}
          onClose={() => setShareOpen(false)}
        />
      )}
    </article>
  );
}
