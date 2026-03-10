"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { ShareModal } from "@/components/share-modal";
import { radioToShareable } from "@/lib/share-utils";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { radioToUnified } from "@/lib/radio-utils";
import { isValidStreamUrl } from "@/lib/url-validation";
import type { RadioStream } from "@/lib/source-types";

const DEFAULT_IMAGE = "/radio-default.svg";

type Props = {
  station: RadioStream;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
};

function RadioLogo() {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-lg bg-black/70 shadow-[0_2px_6px_rgba(0,0,0,0.4)] ring-1 ring-black/30 text-rose-400"
      title="Radio"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 9a5 5 0 0 1 5 5v1h6v-1a5 5 0 0 1 5-5" />
        <path d="M4 14h16" />
        <circle cx="12" cy="18" r="2" />
      </svg>
    </span>
  );
}

export function RadioStreamCard({ station, onRemove, onEdit }: Props) {
  const router = useRouter();
  const { t } = useTranslations();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { playSource, stop, pause, currentSource } = usePlayback();
  const unified = radioToUnified(station);
  const active = currentSource?.id === station.id;

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/radio/${station.id}`, { method: "DELETE" });
      if (res.ok) {
        onRemove(station.id);
        router.refresh();
      }
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  const cover = station.cover || DEFAULT_IMAGE;
  const hasInvalidUrl = !isValidStreamUrl(station.url);

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-xl border bg-slate-950/60 transition-all hover:border-slate-700/80 hover:bg-slate-900/40 ${
        active ? "playing-active border-slate-600/50 shadow-[0_0_20px_rgba(244,63,94,0.15)]" : "border-slate-800/80"
      }`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900">
        {cover ? (
          <img
            src={cover}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = DEFAULT_IMAGE;
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-slate-500">
            <svg className="h-10 w-10 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 9a5 5 0 0 1 5 5v1h6v-1a5 5 0 0 1 5-5" />
              <path d="M4 14h16" />
              <circle cx="12" cy="18" r="2" />
            </svg>
          </div>
        )}
        {hasInvalidUrl && (
          <div
            className="absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/90 text-slate-900"
            title="Invalid or unreachable URL – edit to fix"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              <line x1="12" y1="9" x2="12" y2="13" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-1.5">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{station.name}</h3>
          <RadioLogo />
        </div>
        {station.genre && (
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{station.genre}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label="Radio controls">
          {active && (
            <>
              <NeonControlButton onClick={stop} size="sm" title="Stop" aria-label="Stop">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </NeonControlButton>
              <NeonControlButton onClick={() => playSource(unified)} size="md" active title="Play" aria-label="Play">
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
            <NeonControlButton onClick={() => playSource(unified)} size="md" title="Play" aria-label="Play">
              <svg className="h-4 w-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7L8 5z" />
              </svg>
            </NeonControlButton>
          )}
          <NeonControlButton size="sm" onClick={() => onEdit(station.id)} title={t.edit} aria-label={t.edit}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </NeonControlButton>
          <NeonControlButton size="sm" onClick={() => setShareOpen(true)} title={t.share} aria-label={t.share}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </NeonControlButton>
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
          item={radioToShareable(station)}
          fallbackRadioId={station.id}
          onClose={() => setShareOpen(false)}
        />
      )}
    </article>
  );
}
