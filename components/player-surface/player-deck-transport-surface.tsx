"use client";

import { NeonControlButton } from "@/components/ui/neon-control-button";
import { ActionButtonShare, ActionButtonEdit } from "@/components/ui/action-buttons";
import {
  PlaybackTransportIconNext,
  PlaybackTransportIconPause,
  PlaybackTransportIconPlay,
  PlaybackTransportIconPrev,
  PlaybackTransportIconStop,
  PlaybackTransportIconVolume,
  PlaybackTransportIconVolumeMuted,
} from "@/components/player-surface/playback-transport-icons";
import type { PlayerDeckTransportSurfaceProps } from "@/lib/player-surface/player-deck-transport-types";

/**
 * First row of the in-shell player: transport, automix/shuffle, deck volume rail, share.
 * Shared surface for browser + desktop branch parity; timeline/seek lives in `AudioPlayer`.
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
    displayVolume,
    onVolumeChange,
    onMuteToggle,
    onShareClick,
    shareDisabled,
    editHref,
    onEditClick,
    labels,
  } = props;

  const libDeck = variant === "library-deck";
  const transportVariant = libDeck ? "cyan" : "green";

  return (
    <div className="flex w-full flex-wrap items-center gap-2 gap-y-2 sm:gap-3">
      <NeonControlButton
        size="md"
        variant={transportVariant}
        libraryDeck={libDeck}
        onClick={onPrev}
        disabled={prevNextDisabled}
        aria-label={labels.previousTrack}
        title={labels.previousTrack}
      >
        <PlaybackTransportIconPrev className="h-5 w-5 sm:h-6 sm:w-6" />
      </NeonControlButton>
      <NeonControlButton
        size="md"
        variant={transportVariant}
        libraryDeck={libDeck}
        onClick={onStop}
        disabled={contentDisabled}
        aria-label={labels.stopPlayback}
        title={labels.stopPlayback}
      >
        <PlaybackTransportIconStop className="h-5 w-5 sm:h-6 sm:w-6" />
      </NeonControlButton>
      <NeonControlButton
        size="xl"
        variant={transportVariant}
        libraryDeck={libDeck}
        libraryDeckHero={libDeck}
        onClick={onPlayPause}
        disabled={contentDisabled}
        active={isPlaying}
        aria-label={isPlaying ? labels.pausePlayback : labels.play}
        title={isPlaying ? labels.pausePlayback : labels.play}
        className={`!h-11 !min-w-[90px] !w-auto !px-4 sm:!h-12 sm:!min-w-[110px] sm:!px-6${
          libDeck && isPlaying ? " library-player-play-emerald" : ""
        }`}
      >
        <span className="relative flex h-8 w-8 items-center justify-center sm:h-9 sm:w-9" aria-hidden>
          <PlaybackTransportIconPause
            className={`absolute h-5 w-5 sm:h-6 sm:w-6 ${isPlaying ? "opacity-100" : "pointer-events-none opacity-0"}`}
          />
          <PlaybackTransportIconPlay
            className={`absolute ml-0.5 sm:ml-1 h-5 w-5 sm:h-6 sm:w-6 ${isPlaying ? "pointer-events-none opacity-0" : "opacity-100"}`}
          />
        </span>
      </NeonControlButton>
      <NeonControlButton
        size="md"
        variant={transportVariant}
        libraryDeck={libDeck}
        onClick={onNext}
        disabled={prevNextDisabled}
        aria-label={labels.next}
        title={labels.next}
      >
        <PlaybackTransportIconNext className="h-5 w-5 sm:h-6 sm:w-6" />
      </NeonControlButton>
      <div className="h-5 w-px shrink-0 bg-slate-700/80" aria-hidden />
      <NeonControlButton
        size="2xs"
        variant="cyan"
        libraryDeck={libDeck}
        onClick={onAutoMixToggle}
        active={displayAutoMix}
        disabled={contentDisabled}
        aria-label={labels.autoMix}
        title={labels.autoMix}
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
        </svg>
      </NeonControlButton>
      <NeonControlButton
        size="2xs"
        variant="cyan"
        libraryDeck={libDeck}
        onClick={onShuffleToggle}
        active={displayShuffle}
        disabled={contentDisabled}
        aria-label={labels.random}
        title={labels.random}
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4l5 5-5 5M20 4l-5 5 5 5M20 20l-5-5 5-5M4 20l5-5-5-5" />
        </svg>
      </NeonControlButton>
      <div className="h-5 w-px shrink-0 bg-slate-700/80" aria-hidden />
      {/*
        Volume rail is capped with max-w so the native <input type="range">
        doesn't stretch to its intrinsic ~250px and push the Edit/Share
        action pair onto a second row on narrower decks. `shrink` still
        lets it collapse gracefully on very tight containers.
      */}
      <div
        className={`flex min-w-[52px] max-w-[140px] shrink items-center gap-1 rounded-xl border px-1.5 py-1 sm:min-w-[70px] sm:max-w-[160px] sm:gap-1.5 sm:px-2 md:min-w-[90px] md:max-w-[180px] md:gap-2 md:px-2.5 lg:min-w-[110px] lg:max-w-[200px] ${
          libDeck
            ? "library-player-volume-shell border-[color:var(--lib-accent-border)] bg-[color:var(--lib-surface-segment)] shadow-[var(--lib-shadow-rail-inset)]"
            : "rounded-lg border-cyan-500/50 bg-slate-900/80"
        }`}
      >
        <button
          type="button"
          onClick={onMuteToggle}
          className={
            libDeck
              ? "flex shrink-0 items-center justify-center text-[color:var(--lib-accent)] transition-colors hover:opacity-90"
              : "flex shrink-0 items-center justify-center text-cyan-500 transition-colors hover:text-cyan-400"
          }
          aria-label={displayVolume === 0 ? labels.unmute : labels.mute}
          title={displayVolume === 0 ? labels.unmute : labels.mute}
        >
          {displayVolume === 0 ? (
            <PlaybackTransportIconVolumeMuted className="h-4 w-4 sm:h-5 sm:w-5" />
          ) : (
            <PlaybackTransportIconVolume className="h-4 w-4 sm:h-5 sm:w-5" />
          )}
        </button>
        <div className="relative flex min-w-0 flex-1 items-center py-2">
          <div
            className={`absolute inset-x-0 top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full ${libDeck ? "bg-[color:var(--lib-border-muted)]" : "bg-slate-700/80"}`}
            aria-hidden
          />
          <div
            className={`absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-all duration-100 ${
              libDeck ? "bg-[color:var(--lib-accent)]" : "bg-cyan-500"
            }`}
            style={{ width: `${displayVolume}%` }}
            aria-hidden
          />
          <input
            type="range"
            min={0}
            max={100}
            value={displayVolume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="player-volume-slider relative z-10 h-[3px] w-full cursor-pointer"
            aria-label={labels.volumeAria}
          />
        </div>
        <span
          className={`w-5 shrink-0 text-end text-[10px] font-bold tabular-nums sm:w-6 sm:text-xs ${
            libDeck ? "text-[color:var(--lib-accent-text)]" : "text-cyan-500"
          }`}
          style={libDeck ? undefined : { color: "#06b6d4" }}
        >
          {displayVolume}
        </span>
      </div>
      {/*
        Track-level action pair (Edit + Share) sit together in a shrink-0
        flex group — prevents the two square icon buttons from wrapping
        individually onto separate rows (a narrower volume rail already
        leaves room for them on the main transport row).
      */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {onEditClick ? (
          <ActionButtonEdit onClick={onEditClick} variant="player" aria-label={labels.edit} title={labels.edit} />
        ) : editHref ? (
          <ActionButtonEdit href={editHref} variant="player" aria-label={labels.edit} title={labels.edit} />
        ) : null}
        {libDeck ? (
          <ActionButtonShare variant="player" onClick={onShareClick} disabled={shareDisabled} aria-label={labels.share} title={labels.share} />
        ) : (
          <NeonControlButton
            size="2xs"
            variant="white"
            onClick={onShareClick}
            disabled={shareDisabled}
            aria-label={labels.share}
            title={labels.share}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </NeonControlButton>
        )}
      </div>
    </div>
  );
}
