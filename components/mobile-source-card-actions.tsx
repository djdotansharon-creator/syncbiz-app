"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "@/lib/locale-context";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import type { UnifiedSource } from "@/lib/source-types";

type Props = {
  source: UnifiedSource;
  onRemove?: (id: string, origin?: UnifiedSource["origin"]) => void;
  /** When set, edit links include return param for redirect after save (e.g. /mobile). */
  editReturnTo?: string;
};

/** Overflow menu with Edit, Delete, Share for mobile source cards. */
export function MobileSourceCardActions({ source, onRemove, editReturnTo }: Props) {
  const { t } = useTranslations();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent | PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, []);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      if (source.origin === "playlist" && source.playlist) {
        await fetch(`/api/playlists/${source.playlist.id}`, { method: "DELETE" });
      } else if (source.origin === "source" && source.source) {
        await fetch(`/api/sources/${source.source.id}`, { method: "DELETE" });
      } else if (source.origin === "radio" && source.radio) {
        await fetch(`/api/radio/${source.radio.id}`, { method: "DELETE" });
      }
    } finally {
      onRemove?.(source.id, source.origin);
      setDeleting(false);
      setDeleteOpen(false);
      setMenuOpen(false);
    }
  };

  const baseEdit =
    source.origin === "playlist" && source.playlist
      ? `/playlists/${source.playlist.id}/edit`
      : source.origin === "radio" && source.radio
        ? `/radio/${source.radio.id}/edit`
        : source.origin === "source" && source.source
          ? `/sources/${source.source.id}/edit`
          : null;
  const editHref = baseEdit && editReturnTo ? `${baseEdit}?return=${encodeURIComponent(editReturnTo)}` : baseEdit;

  const canDelete = source.origin === "playlist" || source.origin === "source" || source.origin === "radio";

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700/60 text-slate-400 transition hover:bg-slate-600/80 hover:text-slate-200"
        aria-label={t.share}
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="6" cy="12" r="1.5" />
          <circle cx="18" cy="12" r="1.5" />
        </svg>
      </button>

      {menuOpen && (
        <div
          className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-slate-700/80 bg-slate-900/98 py-1 shadow-xl ring-1 ring-slate-700/60"
          role="menu"
        >
          {editHref && (
            <Link
              href={editHref}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800/80"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
            >
              <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {t.edit}
            </Link>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShareOpen(true);
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800/80"
            role="menuitem"
          >
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            {t.share}
          </button>
          {canDelete && onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteOpen(true);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-400 transition hover:bg-slate-800/80"
              role="menuitem"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              {t.deletePlaylist}
            </button>
          )}
        </div>
      )}

      <DeleteConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        loading={deleting}
        message={t.deleteSourceConfirm}
      />
      {shareOpen && (
        <ShareModal
          item={unifiedSourceToShareable(source)}
          fallbackPlaylistId={source.origin === "playlist" ? source.id : undefined}
          fallbackRadioId={source.origin === "radio" && source.radio ? source.radio.id : undefined}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
