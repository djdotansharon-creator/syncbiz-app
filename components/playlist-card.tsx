"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { PlaylistIconBadge } from "@/components/playlist-icon-badge";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { EmbeddedPlayer } from "@/components/embedded-player";
import {
  ActionButtonPlay,
  ActionButtonStop,
  ActionButtonPause,
  ActionButtonPrev,
  ActionButtonNext,
  ActionButtonEdit,
} from "@/components/ui/action-buttons";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { canEmbedInCard } from "@/lib/playlist-utils";
import { usePlaylistPlayer } from "@/lib/playlist-player-context";
import type { Playlist } from "@/lib/playlist-types";

type Props = {
  playlist: Playlist;
  index: number;
  onShare?: (p: Playlist) => void;
};

function DefaultThumbnail() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-slate-500">
      <svg className="h-14 w-14 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

export function PlaylistCard({ playlist, index, onShare }: Props) {
  const router = useRouter();
  const { t } = useTranslations();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    playlists,
    status,
    volume,
    isActive,
    play,
    pause,
    stop,
    prev,
    next,
    setVolume,
  } = usePlaylistPlayer();

  const active = isActive(index);
  const embedded = canEmbedInCard(playlist.type);
  const localOrStream = !embedded;

  const thumbnail =
    playlist.thumbnail ||
    (playlist.type === "youtube"
      ? `https://img.youtube.com/vi/${playlist.url.match(/(?:v=|\/)([^&\s?/]+)/)?.[1]}/hqdefault.jpg`
      : null);

  useEffect(() => {
    if (!active || !localOrStream || status !== "playing") return;
    const ctrl = new AbortController();
    fetch("/api/commands/play-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: playlist.url }),
      signal: ctrl.signal,
    }).catch(() => {});
    return () => {
      ctrl.abort();
      if (active && localOrStream && status === "playing") {
        fetch("/api/commands/stop-local", { method: "POST" }).catch(() => {});
      }
    };
  }, [active, localOrStream, status, playlist.url]);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/playlists/${playlist.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) throw new Error("Failed to delete");
    router.refresh();
  }

  async function handleStopLocal() {
    await fetch("/api/commands/stop-local", { method: "POST" });
    stop();
  }

  const showTransport = active && (embedded || localOrStream);
  const hasPrevNext = playlists.length > 1;

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-2xl border bg-slate-950/50 transition-all ${
        active ? "playing-active border-slate-600/50" : "border-slate-800/60 hover:border-slate-700/80"
      }`}
    >
      {/* Cover + platform icon */}
      <div className="relative aspect-square w-full overflow-hidden bg-slate-900">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        {!thumbnail && <DefaultThumbnail />}
        <div className="absolute bottom-2 right-2">
          <PlaylistIconBadge type={playlist.type} size="lg" />
        </div>
      </div>

      {/* Title, genre, source type */}
      <div className="flex flex-1 flex-col gap-1 p-4 text-center">
        <h3 className="truncate text-base font-semibold text-slate-100">{playlist.name}</h3>
        {playlist.genre && (
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{playlist.genre}</p>
        )}
        <p className="text-xs capitalize text-slate-600">{playlist.type.replace(/-/g, " ")}</p>
      </div>

      {/* Embedded player when active */}
      {showTransport && embedded && (
        <div className="px-3 pb-2">
          <EmbeddedPlayer
            playlist={playlist}
            status={status === "playing" ? "playing" : status === "paused" ? "paused" : "stopped"}
            volume={volume}
            onVolumeChange={setVolume}
          />
        </div>
      )}

      {/* Centered playback controls - Tesla-style */}
      <div className="flex flex-col items-center gap-3 px-4 pb-4">
        <div className="flex items-center justify-center gap-2">
          {hasPrevNext && (
            <ActionButtonPrev onClick={prev} size="sm" title="Previous playlist" aria-label="Previous playlist" />
          )}
          {showTransport && (
            <>
              <ActionButtonStop
                onClick={embedded ? stop : () => void handleStopLocal()}
                size="sm"
                title="Stop"
                aria-label="Stop"
              />
              <ActionButtonPlay onClick={() => play(index)} size="lg" title="Play" aria-label="Play" />
              {embedded && (
                <ActionButtonPause onClick={pause} size="sm" title="Pause" aria-label="Pause" />
              )}
            </>
          )}
          {!showTransport && (
            <ActionButtonPlay onClick={() => play(index)} size="lg" title="Play" aria-label="Play" />
          )}
          {hasPrevNext && (
            <ActionButtonNext onClick={next} size="sm" title="Next playlist" aria-label="Next playlist" />
          )}
        </div>

        {/* Volume when active (for embedded) or always show compact */}
        {active && (
          <div className="flex w-full max-w-[180px] items-center gap-2">
            <span className="text-[10px] font-medium uppercase text-slate-600">Vol</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="h-1.5 flex-1 rounded-full bg-slate-800 accent-[#1db954]"
              aria-label="Volume"
            />
          </div>
        )}

        {/* Edit, Share, Delete */}
        <div className="flex items-center justify-center gap-2">
          <ActionButtonEdit
            href={`/playlists/${playlist.id}/edit`}
            title={t.editPlaylist}
            aria-label={t.editPlaylist}
          />
          <NeonControlButton
            size="sm"
            onClick={() => onShare?.(playlist)}
            title={t.sharePlaylist}
            aria-label={t.sharePlaylist}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </NeonControlButton>
          <NeonControlButton variant="red" size="sm" onClick={() => setDeleteOpen(true)} title={t.deletePlaylist} aria-label={t.deletePlaylist}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </NeonControlButton>
        </div>
      </div>

      <DeleteConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        loading={deleting}
        message={t.deletePlaylistConfirm}
      />
    </article>
  );
}
