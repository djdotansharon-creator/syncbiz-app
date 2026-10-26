"use client";

/**
 * "Add to playlist" — simplified (2026-10-18, owner: "the whole playlist matter is complicated, simplify"):
 * ONE flat list of playlists (no Your / Ready / Scheduled sections), a filter only when the list is long, one tap
 * adds the song and confirms with a ✓ before the dialog closes. Same glass dialog as share / edit.
 */

import { useState } from "react";
import { useTranslations } from "@/lib/locale-context";
import { GlassModal } from "@/components/glass-modal";
import { NewPlaylistPop } from "@/components/new-playlist-pop";
import { useTr } from "@/lib/i18n/use-tr";

export type PlaylistPickerRow = { key: string; label: string };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  yourPlaylists: PlaylistPickerRow[];
  readyPlaylists: PlaylistPickerRow[];
  scheduledPlaylists: PlaylistPickerRow[];
  onPick: (playlistKey: string) => void;
  /** The song being added (shown in the header). */
  itemTitle?: string | null;
  itemCover?: string | null;
  /** Creates a playlist and resolves its key (null = failed). Enables the "new playlist" plus here (round 6). */
  onCreatePlaylist?: (name: string) => Promise<string | null>;
};

export function AddLeafToPlaylistModal({
  isOpen,
  onClose,
  yourPlaylists,
  readyPlaylists,
  scheduledPlaylists,
  onPick,
  itemTitle,
  itemCover,
  onCreatePlaylist,
}: Props) {
  const tr = useTr();
  const { t } = useTranslations();
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  // fresh state every time the dialog is opened (render-phase reset — allowed pattern)
  if (!isOpen && (picked !== null || filter !== "" || creating)) {
    setPicked(null);
    setFilter("");
    setCreating(false);
  }
  if (!isOpen) return null;

  const seen = new Set<string>();
  const rows = [...yourPlaylists, ...readyPlaylists, ...scheduledPlaylists].filter((r) => {
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
  const q = filter.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;

  return (
    <GlassModal
      title={t.addToPlaylistModalTitle ?? "Add to playlist"}
      subtitle={itemTitle ?? null}
      cover={itemCover ?? null}
      showInitial
      width={480}
      onClose={onClose}
    >
      {rows.length > 7 ? (
        <input className="sb-wz-input" style={{ marginBottom: 12 }} placeholder={tr("Find a playlist")} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      ) : null}
      {onCreatePlaylist && rows.length === 0 ? (
        <button type="button" className="sb-pl-plus" style={{ height: 132, width: "100%", margin: "4px 0 0" }} onClick={() => setCreating(true)} aria-label={tr("New playlist")} title={tr("New playlist")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
            <path d="M12 4.5v15M4.5 12h15" />
          </svg>
        </button>
      ) : null}
      {onCreatePlaylist && rows.length > 0 ? (
        <button type="button" className="sb-wz-pick sb-wz-pick--new" style={{ marginBottom: 8 }} onClick={() => setCreating(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="name">{tr("New playlist")}</span>
          <span className="st" />
        </button>
      ) : null}
      {creating && onCreatePlaylist ? (
        <NewPlaylistPop
          onClose={() => setCreating(false)}
          onCreate={async (name) => {
            const key = await onCreatePlaylist(name);
            if (!key) return false;
            // the new playlist exists — put the song in it once the check has finished its movement
            setTimeout(() => onPick(key), 1500);
            return true;
          }}
        />
      ) : null}
      {shown.length === 0 && !(onCreatePlaylist && rows.length === 0) ? (
        <p className="sb-wz-hint" style={{ textAlign: "center", padding: "26px 0" }}>{t.addToPlaylistEmptySection ?? "No playlists yet"}</p>
      ) : shown.length === 0 ? null : (
        <div className="sb-wz-rows" style={{ maxHeight: 320 }}>
          {shown.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`sb-wz-pick${picked === r.key ? " is-picked" : ""}`}
              onClick={() => {
                if (picked) return;
                setPicked(r.key);
                setTimeout(() => onPick(r.key), 420);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M4 7h11M4 12h11M4 17h7M18 15V6l3 1" />
                <circle cx="16" cy="17" r="2.2" />
              </svg>
              <span className="name">{r.label}</span>
              <span className="st">
                {picked === r.key ? (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5.5 12.5l4.2 4.2L18.5 7.8" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5.5v13M5.5 12h13" /></svg>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      <div style={{ height: 22 }} />
    </GlassModal>
  );
}
