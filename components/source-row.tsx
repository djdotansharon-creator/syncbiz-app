"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionButtonPlayNow,
  ActionButtonEdit,
  ActionButtonDelete,
} from "@/components/ui/action-buttons";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { supportsEmbedded, getSourceArtworkUrl, getSourceIconType } from "@/lib/player-utils";
import { SourceIconBadge } from "@/components/source-icon-badge";
import { DenseDataRowSurface } from "@/components/player-surface/dense-data-row-surface";
import { DENSE_LEGACY_SOURCE_ROW_GRID_CLASS } from "@/lib/player-surface/dense-data-row-constants";
import type { Source } from "@/lib/types";

function DefaultMusicArtwork() {
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-slate-500"
      aria-hidden
    >
      <svg
        className="h-6 w-6 opacity-60"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

function SourceRowArtwork({ source }: { source: Source }) {
  const [errored, setErrored] = useState(false);
  const artworkUrl = getSourceArtworkUrl(source);
  const iconType = getSourceIconType(source);
  return (
    <div className="relative h-full w-full overflow-hidden">
      {artworkUrl && !errored ? (
        <img
          src={artworkUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-slate-800">
          <DefaultMusicArtwork />
        </div>
      )}
      <div className="absolute bottom-0 right-0 p-0.5">
        <SourceIconBadge type={iconType} size="sm" />
      </div>
    </div>
  );
}

type SourceRowProps = {
  source: Source;
};

export function SourceRow({ source }: SourceRowProps) {
  const router = useRouter();
  const { t } = useTranslations();
  const { playSourceFromDb, setLastMessage } = usePlayback();
  const [playing, setPlaying] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handlePlayNow() {
    if (supportsEmbedded(source)) {
      router.push(`/player?sourceId=${source.id}`);
      return;
    }
    setPlaying(true);
    setLastMessage(null);
    try {
      playSourceFromDb(source);
      const target = (source.target ?? source.uriOrPath ?? "").trim();
      if (target) {
        const res = await fetch("/api/commands/play-local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            browserPreference: source.browserPreference ?? "default",
          }),
        });
        setLastMessage(res.ok ? "Local playback command sent" : `Failed: ${(await res.json().catch(() => ({}))).error ?? "Unknown error"}`);
      }
      router.refresh();
    } finally {
      setPlaying(false);
    }
  }

  async function handleDeleteConfirm() {
    setDeleting(true);
    const res = await fetch(`/api/sources/${source.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) throw new Error("Failed to delete");
    router.refresh();
  }

  const typeLabel = t[`sourceType_${source.type}`] ?? source.type.replace(/_/g, " ");

  return (
    <div>
      <DenseDataRowSurface
        gridClassName={DENSE_LEGACY_SOURCE_ROW_GRID_CLASS}
        cells={[
          <div key="thumb" className="flex h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-slate-900">
            <SourceRowArtwork source={source} />
          </div>,
          <div key="title" className="min-w-0">
            <p className="font-medium text-slate-100 truncate">{source.name}</p>
            {source.description ? (
              <p className="text-xs text-slate-500 truncate">{source.description}</p>
            ) : null}
          </div>,
          <div key="type">
            <p className="text-slate-300">{typeLabel}</p>
          </div>,
          <div key="target" className="min-w-0">
            <p className="truncate text-slate-400 text-xs">{source.target ?? source.uriOrPath}</p>
          </div>,
          <div key="live" className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${source.isLive ? "bg-emerald-400" : "bg-slate-500"}`}
            />
            <span className="text-slate-500 text-xs">{source.isLive ? t.available : t.configured}</span>
          </div>,
          <div key="actions" className="flex items-center gap-2">
            <ActionButtonPlayNow
              onClick={handlePlayNow}
              loading={playing}
              disabled={playing}
              label={t.play}
              loadingLabel={t.sending}
            />
            <ActionButtonEdit
              href={`/sources/${source.id}/edit`}
              size="xs"
              title={t.edit}
              aria-label={t.edit}
            />
            <ActionButtonDelete
              onClick={() => setDeleteModalOpen(true)}
              size="xs"
              title={t.delete}
              aria-label={t.delete}
            />
          </div>,
        ]}
      />
      <DeleteConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        loading={deleting}
      />
    </div>
  );
}
