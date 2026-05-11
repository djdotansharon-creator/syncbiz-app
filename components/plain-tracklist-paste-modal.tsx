"use client";

/**
 * Stage 6D-Lite — paste-tracklist textarea modal.
 *
 * Owns nothing beyond the textarea + a parsed-summary readout. On "Find on
 * YouTube" it hands the parsed rows to the parent, which builds a
 * `M3uYoutubeResolveContextState` in `create_youtube_only` mode and opens
 * the existing `M3uYoutubeResolveModal` — that modal carries the rest of
 * the flow (Auto find all, Apply safe matches, manual review, save).
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  PASTED_TRACKLIST_MAX,
  parsePastedTracklist,
  type ParsedTracklist,
} from "@/lib/plain-tracklist-parser";

const PLACEHOLDER = `1. Artist — Title
2. Artist - Title
Artist | Title
Just a Title`;

export function PlainTracklistPasteModal({
  defaultPlaylistName,
  onCancel,
  onSubmit,
}: {
  defaultPlaylistName: string;
  onCancel: () => void;
  /** Caller builds resolver context + opens the YouTube modal. */
  onSubmit: (args: { playlistName: string; parsed: ParsedTracklist }) => void;
}): ReactElement {
  const [text, setText] = useState("");
  const [playlistName, setPlaylistName] = useState(defaultPlaylistName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const parsed = useMemo(() => parsePastedTracklist(text), [text]);
  const canSubmit = parsed.rows.length > 0;

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/[0.38]"
        aria-hidden
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onCancel();
        }}
      />
      <div
        className="fixed inset-0 z-[101] flex items-end justify-center p-0 pointer-events-none sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Paste tracklist to build a YouTube playlist"
      >
        <div
          className="pointer-events-auto flex max-h-[min(640px,calc(100vh-24px))] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-950 shadow-xl sm:rounded-2xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
            <div className="min-w-0">
              <p className="text-base font-semibold text-slate-100">Paste tracklist</p>
              <p className="mt-1 text-xs leading-snug text-slate-400">
                One track per line. Supports <span className="font-mono">Artist — Title</span>,{" "}
                <span className="font-mono">Artist - Title</span>,{" "}
                <span className="font-mono">Artist | Title</span>, or just a title. Leading numbering
                like <span className="font-mono">1.</span> / <span className="font-mono">01)</span>{" "}
                is stripped. Up to {PASTED_TRACKLIST_MAX} tracks.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Playlist name
            </label>
            <input
              type="text"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#1ed760]/70 focus:outline-none focus:ring-2 focus:ring-[#1ed760]/30"
              placeholder={defaultPlaylistName}
            />

            <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Tracklist
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              spellCheck={false}
              autoFocus
              placeholder={PLACEHOLDER}
              className="mt-1 w-full resize-y rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-[#1ed760]/70 focus:outline-none focus:ring-2 focus:ring-[#1ed760]/30"
            />

            <div
              className="mt-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-slate-800/90 bg-slate-900/50 px-3 py-2 font-mono text-[11px] text-slate-300"
              role="status"
              aria-live="polite"
            >
              <span>
                Parsed <span className="font-semibold text-slate-100">{parsed.rows.length}</span>
              </span>
              {parsed.totalLines !== parsed.rows.length ? (
                <>
                  <span className="text-slate-600" aria-hidden>·</span>
                  <span>
                    Detected <span className="font-semibold text-slate-100">{parsed.totalLines}</span>
                  </span>
                </>
              ) : null}
              {parsed.truncated ? (
                <>
                  <span className="text-slate-600" aria-hidden>·</span>
                  <span className="text-amber-200/90">
                    Capped at {PASTED_TRACKLIST_MAX} — extra lines were ignored
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/95 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              title={canSubmit ? undefined : "Paste at least one tracklist line"}
              onClick={() =>
                onSubmit({
                  playlistName: playlistName.trim() || defaultPlaylistName,
                  parsed,
                })
              }
              className="rounded-lg bg-gradient-to-b from-[#1ed760] to-[#1db954] px-5 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)] hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
            >
              Find on YouTube
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
