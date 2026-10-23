"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "@/lib/locale-context";

/** Match schedule modal / library console: single scroll region inside flex column (no nested overflow on panel). */
const PANEL_OUTER =
  "relative flex w-full max-w-md max-h-[min(90dvh,40rem)] flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-[#0b111b]/95 p-0 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_48px_rgba(0,0,0,0.55)] ring-1 ring-slate-900/80";
const PANEL_HEADER = "shrink-0 border-b border-slate-800/80 px-5 pt-5 pb-3";
const PANEL_SCROLL = "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3";
const PANEL_FOOTER = "shrink-0 border-t border-slate-800/80 px-5 py-4";

export type PlaylistPickerRow = { key: string; label: string };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  yourPlaylists: PlaylistPickerRow[];
  readyPlaylists: PlaylistPickerRow[];
  scheduledPlaylists: PlaylistPickerRow[];
  onPick: (playlistKey: string) => void;
};

function Section({
  title,
  rows,
  onPick,
}: {
  title: string;
  rows: PlaylistPickerRow[];
  onPick: (key: string) => void;
}) {
  const { t } = useTranslations();
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.55)]"
          aria-hidden
        />
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/95">{title}</h3>
      </div>
      <ul className="mt-2 space-y-1">
        {rows.length === 0 ? (
          <li className="rounded-lg px-3 py-2 text-xs text-slate-500">{t.addToPlaylistEmptySection}</li>
        ) : (
          rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => onPick(row.key)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-slate-800/80 hover:text-white"
              >
                {row.label}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export function AddLeafToPlaylistModal({
  isOpen,
  onClose,
  yourPlaylists,
  readyPlaylists,
  scheduledPlaylists,
  onPick,
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

  const overlay = (
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-leaf-playlist-modal-title"
      onClick={onClose}
    >
      <div className={PANEL_OUTER} onClick={(e) => e.stopPropagation()}>
        <div className={PANEL_HEADER}>
          <h2 id="add-leaf-playlist-modal-title" className="text-lg font-semibold tracking-tight text-slate-50">
            {t.addToPlaylistModalTitle}
          </h2>
        </div>
        <div className={PANEL_SCROLL}>
          <Section title={t.addToPlaylistYourSection} rows={yourPlaylists} onPick={onPick} />
          <Section title={t.addToPlaylistReadySection} rows={readyPlaylists} onPick={onPick} />
          <Section title={t.addToPlaylistScheduledSection} rows={scheduledPlaylists} onPick={onPick} />
        </div>
        <div className={`${PANEL_FOOTER} flex justify-end`}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700/90 bg-slate-900/50 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800/70"
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
