"use client";

import { ActionButtonShare, ActionButtonEdit } from "@/components/ui/action-buttons";
import {
  PlaybackTransportIconNext,
  PlaybackTransportIconPause,
  PlaybackTransportIconPlay,
  PlaybackTransportIconPrev,
  PlaybackTransportIconStop,
} from "@/components/player-surface/playback-transport-icons";
import type { PlayerDeckTransportSurfaceProps } from "@/lib/player-surface/player-deck-transport-types";

/**
 * Transport dock — CDJ-inspired layout with inviting SyncBiz playback controls.
 */
export function PlayerDeckTransportSurface(props: PlayerDeckTransportSurfaceProps) {
  const {
    variant,
    onPrev,
    onStop,
    onPlayPause,
    onNext,
    prevNextDisabled,
    contentDisabled,
    isPlaying,
    onAutoMixToggle,
    onShuffleToggle,
    displayAutoMix,
    displayShuffle,
    onShareClick,
    shareDisabled,
    editHref,
    onEditClick,
    labels,
  } = props;

  const libDeck = variant === "library-deck";

  return (
    <div className="player-transport-dock w-full min-w-0">
      <div className="player-transport-dock__row flex w-full min-w-0 flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t border-white/[0.04] pt-3 sm:gap-x-7">
        <DeckTransportButton
          onClick={onStop}
          disabled={contentDisabled}
          ariaLabel={labels.stopPlayback}
          title={labels.stopPlayback}
          size="stop"
          libraryDeck={libDeck}
        >
          <PlaybackTransportIconStop className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </DeckTransportButton>

        <div className="player-transport-cluster flex shrink-0 items-center gap-3 sm:gap-4">
          <DeckTransportButton
            onClick={onPrev}
            disabled={prevNextDisabled}
            ariaLabel={labels.previousTrack}
            title={labels.previousTrack}
            size="nav"
            libraryDeck={libDeck}
          >
            <PlaybackTransportIconPrev className="h-5 w-5 sm:h-6 sm:w-6" />
          </DeckTransportButton>

          <DeckTransportButton
            onClick={onPlayPause}
            disabled={contentDisabled}
            active={isPlaying}
            primary
            ariaLabel={isPlaying ? labels.pausePlayback : labels.play}
            title={isPlaying ? labels.pausePlayback : labels.play}
            libraryDeck={libDeck}
            className={libDeck && isPlaying ? "library-player-play-emerald" : undefined}
          >
            <span className="relative flex h-7 w-7 items-center justify-center sm:h-8 sm:w-8" aria-hidden>
              <PlaybackTransportIconPause
                className={`absolute h-5 w-5 sm:h-6 sm:w-6 ${isPlaying ? "opacity-100" : "pointer-events-none opacity-0"}`}
              />
              <PlaybackTransportIconPlay
                className={`absolute ml-0.5 h-5 w-5 sm:h-6 sm:w-6 ${isPlaying ? "pointer-events-none opacity-0" : "opacity-100"}`}
              />
            </span>
          </DeckTransportButton>

          <DeckTransportButton
            onClick={onNext}
            disabled={prevNextDisabled}
            ariaLabel={labels.next}
            title={labels.next}
            size="nav"
            libraryDeck={libDeck}
          >
            <PlaybackTransportIconNext className="h-5 w-5 sm:h-6 sm:w-6" />
          </DeckTransportButton>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ShuffleToggleButton
            active={displayShuffle}
            disabled={contentDisabled}
            onClick={onShuffleToggle}
            ariaLabel={labels.random}
            title={labels.random}
          />

          <AutoMixToggleButton
            active={displayAutoMix}
            disabled={contentDisabled}
            onClick={onAutoMixToggle}
            ariaLabel={labels.autoMix}
            title={labels.autoMix}
          />
        </div>

        <div className="player-transport-secondary flex shrink-0 items-center gap-0.5 opacity-25 transition-opacity duration-200 hover:opacity-50 focus-within:opacity-50">
          {onEditClick ? (
            <ActionButtonEdit onClick={onEditClick} variant="player" aria-label={labels.edit} title={labels.edit} />
          ) : editHref ? (
            <ActionButtonEdit href={editHref} variant="player" aria-label={labels.edit} title={labels.edit} />
          ) : null}
          {libDeck ? (
            <ActionButtonShare variant="player" onClick={onShareClick} disabled={shareDisabled} aria-label={labels.share} title={labels.share} />
          ) : (
            <button
              type="button"
              onClick={onShareClick}
              disabled={shareDisabled}
              aria-label={labels.share}
              title={labels.share}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-30"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Inviting SyncBiz playback control — soft neon accent, restrained premium feel. */
function DeckTransportButton({
  onClick,
  disabled,
  active,
  primary,
  size = "nav",
  libraryDeck,
  ariaLabel,
  title,
  className,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
  size?: "stop" | "nav";
  libraryDeck?: boolean;
  ariaLabel: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const accent = libraryDeck ? "cyan" : "emerald";

  const dim =
    size === "stop"
      ? "h-8 w-8 rounded-lg"
      : primary
        ? "h-11 w-11 rounded-full sm:h-12 sm:w-12"
        : "h-10 w-10 rounded-xl sm:h-11 sm:w-11";

  const tone = primary
    ? active
      ? accent === "cyan"
        ? "deck-transport-btn--play-active"
        : "deck-transport-btn--play-active deck-transport-btn--accent-emerald"
      : accent === "cyan"
        ? "deck-transport-btn--play"
        : "deck-transport-btn--play deck-transport-btn--accent-emerald"
    : size === "stop"
      ? "deck-transport-btn--stop"
      : accent === "cyan"
        ? "deck-transport-btn--nav"
        : "deck-transport-btn--nav deck-transport-btn--accent-emerald";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`deck-transport-btn inline-flex shrink-0 items-center justify-center transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/12 disabled:opacity-35 disabled:pointer-events-none ${dim} ${tone}${className ? ` ${className}` : ""}`}
    >
      {children}
    </button>
  );
}

/** Shuffle — clean standard icon, quiet circle; blue tint when on. */
function ShuffleToggleButton({
  active,
  disabled,
  onClick,
  ariaLabel,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-35 ${
        active
          ? "bg-[#0a84ff]/15 text-[#409cff]"
          : "text-[#8e8e93] hover:bg-white/[0.06] hover:text-[#f5f5f7]"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M16 3h5v5" />
        <path d="M4 20L21 3" />
        <path d="M21 16v5h-5" />
        <path d="M15 15l6 6" />
        <path d="M4 4l5 5" />
      </svg>
    </button>
  );
}

/** AutoMix — labeled pill (mockup style); blue tint when engaged. */
function AutoMixToggleButton({
  active,
  disabled,
  onClick,
  ariaLabel,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-35 ${
        active
          ? "border-[#0a84ff]/40 bg-[#0a84ff]/15 text-[#409cff]"
          : "border-white/[0.1] bg-transparent text-[#8e8e93] hover:border-white/[0.18] hover:text-[#f5f5f7]"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 12h4l3-7 4 14 3-7h2" />
      </svg>
      Automix
    </button>
  );
}

/** @deprecated Compact mode indicator — replaced by ShuffleToggleButton / AutoMixToggleButton. */
function DeckModeIndicator({
  kind,
  label,
  active,
  disabled,
  onClick,
  ariaLabel,
  title,
}: {
  kind: "mix" | "random";
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
}) {
  const showLabel = active ? "deck-mode-indicator--show-label" : "";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
      className={`deck-mode-indicator group inline-flex h-8 w-10 shrink-0 items-center justify-center gap-0 overflow-hidden rounded-lg transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/10 disabled:opacity-35 ${
        active
          ? `deck-mode-indicator--active ${showLabel}`
          : "deck-mode-indicator--idle border-transparent bg-transparent hover:bg-white/[0.03] focus-visible:bg-white/[0.03]"
      }`}
    >
      <span className="flex shrink-0 items-center gap-1">
        {kind === "mix" ? <MixModeIcon active={active} /> : <RandomModeIcon active={active} />}
        <span
          className={`deck-mode-indicator__led h-1 w-1 shrink-0 rounded-full transition-colors ${
            active ? "bg-[#0a84ff]" : "bg-slate-600/80 group-hover:bg-slate-500"
          }`}
          aria-hidden
        />
      </span>
      <span className="deck-mode-indicator__label ml-0 max-w-0 overflow-hidden whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300 opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-[3rem] group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-[3rem] group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );
}

function MixModeIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      className={`shrink-0 ${active ? "text-[#409cff]" : "text-slate-500 group-hover:text-slate-300"}`}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M2 11.5h3.2l2.1-3.2 2.1 3.2H12L8.8 6.5 12 2H8.8L6.7 5.2 4.6 2H2l3.2 4.5L2 11.5z"
      />
    </svg>
  );
}

function RandomModeIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${active ? "text-[#409cff]" : "text-slate-500 group-hover:text-slate-300"}`}
      aria-hidden
    >
      <path d="M2.5 5.5h2.8M2.5 10.5h2.8M10.7 3.5l2.8 2.8-2.8 2.8M10.7 12.5l2.8-2.8-2.8-2.8" />
      <path d="M5.3 5.5h1.2l1.5 5M9 10.5h1.2" />
    </svg>
  );
}

/** @deprecated Use DeckModeIndicator */
export const PlayerModeToggle = DeckModeIndicator;
/** @deprecated Use DeckModeIndicator */
export const PlayerModeChip = DeckModeIndicator;
