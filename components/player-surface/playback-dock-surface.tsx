"use client";

import type { PlaybackDockSurfaceProps } from "@/lib/player-surface/playback-dock-types";
import {
  PlaybackTransportIconNext,
  PlaybackTransportIconPause,
  PlaybackTransportIconPlay,
  PlaybackTransportIconPrev,
  PlaybackTransportIconStop,
  PlaybackTransportIconVolume,
} from "@/components/player-surface/playback-transport-icons";

/** Fixed bottom playback strip — shared by web `/player` PlaybackBar and Electron dock. */
export function PlaybackDockSurface(props: PlaybackDockSurfaceProps) {
  if (props.variant === "empty") {
    return (
      <footer className="sb-pds-root" role="region" aria-label="Playback controls">
        <div className="sb-pds-empty-inner">{props.message}</div>
      </footer>
    );
  }

  const { title, subtitle, volume, onVolumeChange, transport, footerMode } = props;
  const readoutOnly = footerMode === "readout";

  return (
    <footer
      className="sb-pds-root"
      role="region"
      aria-label={readoutOnly ? "Now playing summary" : "Playback controls"}
    >
      <div className={`sb-pds-card${readoutOnly ? " sb-pds-card--readout" : ""}`}>
        {readoutOnly ? (
          <p className="sb-pds-readout-kicker">Now playing</p>
        ) : null}
        <div className="sb-pds-now">
          <p className="sb-pds-title">{title}</p>
          <p className="sb-pds-sub">{subtitle}</p>
        </div>

        {!readoutOnly ? (
          <>
        <div className="sb-pds-transport">
          <button
            type="button"
            className="sb-pds-btn sb-pds-btn-sec"
            onClick={transport.onPrev}
            disabled={transport.prevDisabled}
            aria-label="Previous"
          >
            <PlaybackTransportIconPrev className="sb-pds-ico sb-pds-ico-sm" />
          </button>
          <button
            type="button"
            className="sb-pds-btn sb-pds-btn-sec"
            onClick={transport.onStop}
            disabled={transport.stopDisabled}
            aria-label="Stop"
          >
            <PlaybackTransportIconStop className="sb-pds-ico sb-pds-ico-sm" />
          </button>
          <button
            type="button"
            className="sb-pds-btn sb-pds-btn-play"
            onClick={transport.onPlay}
            disabled={transport.playDisabled}
            aria-label="Play"
          >
            <PlaybackTransportIconPlay className="sb-pds-ico sb-pds-ico-lg" />
          </button>
          <button
            type="button"
            className="sb-pds-btn sb-pds-btn-sec"
            onClick={transport.onPause}
            disabled={transport.pauseDisabled}
            aria-label="Pause"
          >
            <PlaybackTransportIconPause className="sb-pds-ico sb-pds-ico-sm" />
          </button>
          <button
            type="button"
            className="sb-pds-btn sb-pds-btn-sec"
            onClick={transport.onNext}
            disabled={transport.nextDisabled}
            aria-label="Next"
          >
            <PlaybackTransportIconNext className="sb-pds-ico sb-pds-ico-sm" />
          </button>
        </div>

        <div className="sb-pds-vol">
          <PlaybackTransportIconVolume className="sb-pds-vol-ico" />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="sb-pds-range"
            aria-label="Volume"
          />
          <span className="sb-pds-vol-num">{volume}</span>
        </div>
          </>
        ) : null}
      </div>
    </footer>
  );
}
