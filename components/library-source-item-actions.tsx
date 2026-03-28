"use client";

import { NeonControlButton } from "@/components/ui/neon-control-button";
import { ActionButtonEdit, ActionButtonShare } from "@/components/ui/action-buttons";
import { useTranslations } from "@/lib/locale-context";
import type { UnifiedSource } from "@/lib/source-types";

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
}: Props) {
  const { t } = useTranslations();
  const editHref = editHrefForLibrarySource(source);
  const playSize = compact ? "sm" : "md";
  const transportSm = compact ? "sm" : "sm";
  const transportMd = compact ? "md" : "md";

  return (
    <div className="mt-1 flex w-full min-w-0 flex-wrap items-center justify-center gap-1.5" role="group" aria-label={t.sourceControlsAria}>
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
      <ActionButtonShare variant="player" onClick={onShareOpen} title={t.share} aria-label={t.share} />
      {showLibraryDelete ? (
        <NeonControlButton variant="red" size="sm" onClick={onDeletePress} title={t.delete} aria-label={t.delete}>
          <svg className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </NeonControlButton>
      ) : (
        <span className="inline-flex h-7 w-7 shrink-0" aria-hidden />
      )}
    </div>
  );
}
