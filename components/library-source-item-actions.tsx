"use client";

import { useState } from "react";
import { NeonControlButton } from "@/components/ui/neon-control-button";
import { ActionButtonEdit, ActionButtonShare } from "@/components/ui/action-buttons";
import { useTranslations } from "@/lib/locale-context";
import type { UnifiedSource } from "@/lib/source-types";

/** Not-yet-in-library: compact amber deck chip (distinct from share/edit white chrome). */
const LIBRARY_DECK_ADD_TO_LIBRARY_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center select-none rounded-lg border-2 border-amber-500/55 bg-slate-900/95 text-amber-100 shadow-[0_0_0_1px_rgba(245,158,11,0.18),0_0_16px_rgba(245,158,11,0.12)] transition-all duration-200 hover:border-amber-400/80 hover:shadow-[0_0_0_2px_rgba(251,191,36,0.28),0_0_22px_rgba(245,158,11,0.16)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-amber-400/45 focus:ring-offset-2 focus:ring-offset-slate-950 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 disabled:hover:scale-100";

const LIBRARY_DECK_IN_LIBRARY_BTN =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center select-none rounded-lg border-2 border-emerald-500/50 bg-slate-900/95 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_0_16px_rgba(16,185,129,0.14)] transition-all duration-200 hover:border-emerald-400/75 hover:shadow-[0_0_0_2px_rgba(52,211,153,0.28),0_0_22px_rgba(16,185,129,0.18)] hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-emerald-400/45 focus:ring-offset-2 focus:ring-offset-slate-950";

export function editHrefForLibrarySource(source: UnifiedSource): string | null {
  if (source.origin === "playlist" && source.playlist) return `/playlists/${source.playlist.id}/edit`;
  if (source.origin === "radio" && source.radio) return `/radio/${source.radio.id}/edit`;
  if (source.origin === "source" && source.source) return `/sources/${source.source.id}/edit`;
  return null;
}

type Props = {
  source: UnifiedSource;
  onPlay: () => void;
  isActive: boolean;
  onStop: () => void;
  onPause: () => void;
  libraryDeckChrome?: boolean;
  onShareOpen: () => void;
  onDeletePress?: () => void;
  /** Tighter icon sizes for list rows and compact grid cards */
  compact?: boolean;
  /** When false, reserves space so Play / Edit / Share stay aligned */
  showLibraryDelete?: boolean;
  /** Manual add to main library (e.g. expanded Ready Playlist track). */
  onAddToLibrary?: () => void | Promise<void>;
  /** Expanded playlist row already has a matching DB source in All Library (by URL). */
  inLibrary?: boolean;
};

export function LibrarySourceItemActions({
  source,
  onPlay,
  isActive,
  onStop,
  onPause,
  libraryDeckChrome = false,
  onShareOpen,
  onDeletePress = () => {},
  compact = false,
  showLibraryDelete = true,
  onAddToLibrary,
  inLibrary = false,
}: Props) {
  const { t } = useTranslations();
  const [adding, setAdding] = useState(false);
  const editHref = editHrefForLibrarySource(source);
  const playSize = compact ? "sm" : "md";
  const transportSm = compact ? "sm" : "sm";
  const transportMd = compact ? "md" : "md";

  return (
    <div
      className="mt-0.5 flex w-full min-w-0 flex-nowrap items-center justify-center gap-1"
      role="group"
      aria-label={t.sourceControlsAria}
      onClick={(e) => e.stopPropagation()}
    >
      {isActive && (
        <>
          <NeonControlButton
            variant="cyan"
            libraryDeck={libraryDeckChrome}
            onClick={onStop}
            size={transportSm}
            title={t.stopPlayback}
            aria-label={t.stopPlayback}
          >
            <svg className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h12v12H6z" />
            </svg>
          </NeonControlButton>
          <NeonControlButton
            variant="cyan"
            libraryDeck={libraryDeckChrome}
            onClick={() => onPlay()}
            size={transportMd}
            active
            title={t.play}
            aria-label={t.play}
          >
            <svg className={compact ? "h-5 w-5 ml-0.5" : "h-4 w-4 ml-0.5"} viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </NeonControlButton>
          <NeonControlButton
            variant="cyan"
            libraryDeck={libraryDeckChrome}
            onClick={onPause}
            size={transportSm}
            active
            title={t.pausePlayback}
            aria-label={t.pausePlayback}
          >
            <svg className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </NeonControlButton>
        </>
      )}
      {!isActive && (
        <NeonControlButton
          variant="cyan"
          libraryDeck={libraryDeckChrome}
          onClick={() => onPlay()}
          size={playSize}
          title={t.play}
          aria-label={t.play}
        >
          <svg className={compact ? "h-5 w-5 ml-0.5" : "h-4 w-4 ml-0.5"} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7L8 5z" />
          </svg>
        </NeonControlButton>
      )}
      {editHref ? (
        <ActionButtonEdit
          href={editHref}
          variant="player"
          title={
            source.origin === "playlist"
              ? t.editPlaylist
              : source.origin === "radio"
                ? t.radioEdit
                : t.edit
          }
          aria-label={
            source.origin === "playlist"
              ? t.editPlaylist
              : source.origin === "radio"
                ? t.radioEdit
                : t.edit
          }
        />
      ) : (
        <span className="inline-flex h-7 w-7 shrink-0" aria-hidden />
      )}
      {inLibrary ? (
        <span className={LIBRARY_DECK_IN_LIBRARY_BTN} title={t.inLibrary} aria-label={t.inLibrary}>
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </span>
      ) : onAddToLibrary ? (
        <button
          type="button"
          disabled={adding}
          onPointerDownCapture={() => {
            if (process.env.NODE_ENV !== "production") {
              console.log("[SYNC_AUDIT] Add-to-library pointerdown CAPTURE", { listCompact: compact });
            }
          }}
          onMouseDownCapture={() => {
            if (process.env.NODE_ENV !== "production") {
              console.log("[SYNC_AUDIT] Add-to-library mousedown CAPTURE", { listCompact: compact });
            }
          }}
          onClick={() => {
            if (process.env.NODE_ENV !== "production") {
              console.log("[SYNC_AUDIT] Add-to-library click -> handler running", { listCompact: compact });
            }
            void (async () => {
              setAdding(true);
              try {
                await onAddToLibrary();
              } finally {
                setAdding(false);
              }
            })();
          }}
          className={LIBRARY_DECK_ADD_TO_LIBRARY_BTN}
          title={t.addToLibrary}
          aria-label={t.addToLibrary}
        >
          {adding ? (
            <span className="text-[10px] font-bold leading-none text-amber-50/90" aria-hidden>
              …
            </span>
          ) : (
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
        </button>
      ) : null}
      <ActionButtonShare variant="player" onClick={onShareOpen} title={t.share} aria-label={t.share} />
      {showLibraryDelete ? (
        <span
          className="contents"
          onPointerDownCapture={() => {
            if (process.env.NODE_ENV !== "production") {
              console.log("[SYNC_AUDIT] Delete pointerdown CAPTURE", { listCompact: compact });
            }
          }}
          onMouseDownCapture={() => {
            if (process.env.NODE_ENV !== "production") {
              console.log("[SYNC_AUDIT] Delete mousedown CAPTURE", { listCompact: compact });
            }
          }}
        >
          <NeonControlButton
            variant="red"
            size="sm"
            onClick={() => {
              if (process.env.NODE_ENV !== "production") {
                console.log("[SYNC_AUDIT] Delete click -> handler running", { listCompact: compact });
              }
              onDeletePress();
            }}
            title={t.delete}
            aria-label={t.delete}
          >
            <svg className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </NeonControlButton>
        </span>
      ) : (
        <span className="inline-flex h-7 w-7 shrink-0" aria-hidden />
      )}
    </div>
  );
}
