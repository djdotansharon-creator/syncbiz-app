"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionButtonPlayNow,
  ActionButtonEdit,
  ActionButtonDelete,
} from "@/components/ui/action-buttons";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { SourceIconBadge } from "@/components/source-icon-badge";
import { useTranslations } from "@/lib/locale-context";
import { usePlayback } from "@/lib/playback-provider";
import { supportsEmbedded, getSourceArtworkUrl, getSourceIconType } from "@/lib/player-utils";
import type { Source } from "@/lib/types";

function DefaultMusicArtwork() {
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-slate-500"
      aria-hidden
    >
      <svg
        className="h-10 w-10 opacity-60"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

function SourceArtwork({ source, showIcon = true }: { source: Source; showIcon?: boolean }) {
  const [errored, setErrored] = useState(false);
  const artworkUrl = getSourceArtworkUrl(source);
  const iconType = getSourceIconType(source);

  return (
    <div className="relative h-full w-full bg-slate-800">
      {artworkUrl && !errored ? (
        <img
          src={artworkUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <DefaultMusicArtwork />
      )}
      {showIcon && (
        <div className="absolute bottom-0 right-0 p-1.5">
          <SourceIconBadge type={iconType} size="sm" />
        </div>
      )}
    </div>
  );
}

type SourceCardProps = {
  source: Source;
};

export function SourceCard({ source }: SourceCardProps) {
  const router = useRouter();
  const { t } = useTranslations();
  const { playSourceFromDb, setLastMessage } = usePlayback();
  const [playing, setPlaying] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteConfirm() {
    setDeleting(true);
    const res = await fetch(`/api/sources/${source.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) throw new Error("Failed to delete");
    router.refresh();
  }

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
      if (!target) {
        setLastMessage("Failed: No target path");
        return;
      }
      const res = await fetch("/api/commands/play-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          browserPreference: source.browserPreference ?? "default",
        }),
      });
      if (res.ok) {
        setLastMessage("Local playback command sent");
      } else {
        const data = await res.json().catch(() => ({}));
        setLastMessage(data?.error ? `Failed: ${data.error}` : "Playback failed.");
      }
    } finally {
      setPlaying(false);
    }
  }

  const typeLabel = t[`sourceType_${source.type}`] ?? source.type.replace(/_/g, " ");
  const url = source.target ?? source.uriOrPath ?? "";

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/60 transition-all duration-200 hover:border-slate-700/80 hover:bg-slate-900/40"
      data-source-id={source.id}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-t-2xl bg-slate-900">
        <SourceArtwork source={source} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="truncate text-base font-semibold text-slate-100">
          {source.name}
        </h3>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {typeLabel}
        </p>
        {url && (
          <p className="min-h-0 flex-1 truncate text-xs text-slate-500">
            {url}
          </p>
        )}
        <div className="flex flex-col items-center gap-3">
          <div className="flex w-full justify-center">
            <ActionButtonPlayNow
              onClick={handlePlayNow}
              loading={playing}
              disabled={playing}
              label={t.play}
              loadingLabel={t.sending}
            />
          </div>
          <div className="flex w-full items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                source.isLive
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-slate-800 text-slate-500"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  source.isLive ? "bg-emerald-400" : "bg-slate-500"
                }`}
              />
              {source.isLive ? t.available : t.configured}
            </span>
            <div className="flex gap-2">
              <ActionButtonEdit
                href={`/sources/${source.id}/edit`}
                title={t.edit}
                aria-label={t.edit}
              />
              <ActionButtonDelete
                onClick={() => setDeleteModalOpen(true)}
                title={t.delete}
                aria-label={t.delete}
              />
            </div>
          </div>
        </div>
        <DeleteConfirmModal
          isOpen={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={handleDeleteConfirm}
          loading={deleting}
        />
      </div>
    </article>
  );
}
