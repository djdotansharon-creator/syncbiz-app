"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "@/lib/locale-context";
import { GlassModal } from "@/components/glass-modal";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  variant: "all_library" | "in_playlist";
  onRemoveFromPlaylist?: () => void;
  onDeleteFromLibrary: () => void | Promise<void>;
  loading?: boolean;
  showDeleteFromLibrary?: boolean;
};

export function LibraryItemContextDeleteModal({
  isOpen,
  onClose,
  variant,
  onRemoveFromPlaylist,
  onDeleteFromLibrary,
  loading = false,
  showDeleteFromLibrary = true,
}: Props) {
  const { t } = useTranslations();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  async function runDeleteFromLibrary() {
    try {
      await onDeleteFromLibrary();
      onClose();
    } catch {
      /* parent may surface error */
    }
  }

  /* round 7 (owner): same glass dialog as share / edit; pills instead of the grey slate boxes. Only the in-playlist
     variant reaches here now (a plain delete is one step with an Undo toast). */
  const overlay = (
    <GlassModal
      title={variant === "in_playlist" ? t.libraryDeleteInPlaylistTitle : t.libraryDeleteAllTitle}
      subtitle={variant === "in_playlist" ? t.libraryDeleteInPlaylistMessage : t.libraryDeleteAllMessage}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sb-wz-btn" onClick={onClose} disabled={loading}>
            {t.cancel}
          </button>
          <span className="sb-wz-spacer" />
          {variant === "in_playlist" ? (
            <button
              type="button"
              className="sb-wz-btn sb-wz-btn--glass"
              disabled={loading}
              onClick={() => {
                onRemoveFromPlaylist?.();
                onClose();
              }}
            >
              {t.libraryRemoveFromPlaylistOnly}
            </button>
          ) : null}
          {variant === "all_library" || showDeleteFromLibrary ? (
            <button type="button" className="sb-wz-btn sb-wz-btn--primary" disabled={loading} onClick={() => void runDeleteFromLibrary()}>
              {loading ? t.deleting : variant === "in_playlist" ? t.libraryDeleteFromLibraryEntirely : t.libraryDeleteFromLibraryAndAllPlaylists}
            </button>
          ) : null}
        </>
      }
    >
      <div style={{ height: 8 }} />
    </GlassModal>
  );

  return overlay;
}
