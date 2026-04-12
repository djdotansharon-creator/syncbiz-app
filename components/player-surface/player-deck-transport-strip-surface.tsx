"use client";

import type { PlayerDeckTransportStripSurfaceProps } from "@/lib/player-surface/player-deck-transport-strip-types";
import {
  PlaybackTransportIconNext,
  PlaybackTransportIconPause,
  PlaybackTransportIconPlay,
  PlaybackTransportIconPrev,
  PlaybackTransportIconStop,
  PlaybackTransportIconVolume,
} from "@/components/player-surface/playback-transport-icons";

function IconAutoMix({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  );
}

function IconShuffle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 4l5 5-5 5M20 4l-5 5 5 5M20 20l-5-5 5-5M4 20l5-5-5-5" />
    </svg>
  );
}

function IconShare({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

/**
 * In-card deck: transport + automix/shuffle + volume + share — same glyphs as dock/footer where applicable.
 */
export function PlayerDeckTransportStripSurface(props: PlayerDeckTransportStripSurfaceProps) {
  const {
    transport,
    volume,
    onVolumeChange,
    autoMixOn,
    shuffleOn,
    onAutoMixToggle,
    onShuffleToggle,
    extrasDisabled,
    onShareClick,
    shareDisabled,
  } = props;

  return (
    <div className="sb-dkts-root" role="region" aria-label="Deck controls">
      <p className="sb-dkts-label">Deck controls</p>
      <div className="sb-dkts-transport">
        <button
          type="button"
          className="sb-dkts-btn sb-dkts-btn-sec"
          onClick={transport.onPrev}
          disabled={transport.prevDisabled}
          aria-label="Previous"
          title="Previous"
        >
          <PlaybackTransportIconPrev className="sb-dkts-ico sb-dkts-ico-sm" />
        </button>
        <button
          type="button"
          className="sb-dkts-btn sb-dkts-btn-sec"
          onClick={transport.onStop}
          disabled={transport.stopDisabled}
          aria-label="Stop"
          title="Stop"
        >
          <PlaybackTransportIconStop className="sb-dkts-ico sb-dkts-ico-sm" />
        </button>
        <button
          type="button"
          className="sb-dkts-btn sb-dkts-btn-play"
          onClick={transport.onPlay}
          disabled={transport.playDisabled}
          aria-label="Play"
          title="Play"
        >
          <PlaybackTransportIconPlay className="sb-dkts-ico sb-dkts-ico-lg" />
        </button>
        <button
          type="button"
          className="sb-dkts-btn sb-dkts-btn-sec"
          onClick={transport.onPause}
          disabled={transport.pauseDisabled}
          aria-label="Pause"
          title="Pause"
        >
          <PlaybackTransportIconPause className="sb-dkts-ico sb-dkts-ico-sm" />
        </button>
        <button
          type="button"
          className="sb-dkts-btn sb-dkts-btn-sec"
          onClick={transport.onNext}
          disabled={transport.nextDisabled}
          aria-label="Next"
          title="Next"
        >
          <PlaybackTransportIconNext className="sb-dkts-ico sb-dkts-ico-sm" />
        </button>
      </div>

      <div className="sb-dkts-extras">
        <button
          type="button"
          className={`sb-dkts-chip ${autoMixOn ? "sb-dkts-chip--on" : ""}`}
          onClick={onAutoMixToggle}
          disabled={extrasDisabled}
          aria-pressed={autoMixOn}
          aria-label="Auto mix"
          title="Auto mix (mock)"
        >
          <IconAutoMix className="sb-dkts-chip-ico" />
          <span>Mix</span>
        </button>
        <button
          type="button"
          className={`sb-dkts-chip ${shuffleOn ? "sb-dkts-chip--on" : ""}`}
          onClick={onShuffleToggle}
          disabled={extrasDisabled}
          aria-pressed={shuffleOn}
          aria-label="Shuffle"
          title="Shuffle (mock)"
        >
          <IconShuffle className="sb-dkts-chip-ico" />
          <span>Shuffle</span>
        </button>
        <button
          type="button"
          className="sb-dkts-share"
          onClick={onShareClick}
          disabled={shareDisabled}
          aria-label="Share"
          title="Share (browser Library)"
        >
          <IconShare className="sb-dkts-share-ico" />
        </button>
      </div>

      <div className="sb-dkts-deck-vol">
        <PlaybackTransportIconVolume className="sb-dkts-vol-ico" />
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="sb-dkts-vol-range"
          aria-label="Volume"
        />
        <span className="sb-dkts-vol-num">{volume}</span>
      </div>

      <p className="sb-dkts-hint">
        Mock deck row — same IPC volume + transport as footer dock; automix/shuffle are local UI state until engine parity.
      </p>
    </div>
  );
}
