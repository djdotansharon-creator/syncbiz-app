"use client";

import type { PlayerDeckMetaStripSurfaceProps } from "@/lib/player-surface/player-deck-meta-strip-types";

/**
 * Read-only deck meta (PLAY NOW / NEXT) + timeline placeholder — browser `/player` can adopt;
 * Electron mounts first for visible parity without Tailwind/Neon.
 */
export function PlayerDeckMetaStripSurface(props: PlayerDeckMetaStripSurfaceProps) {
  const { nowPlayingLabel, nextLabel, positionLabel, durationLabel, progressPercent } = props;
  const pct = Math.max(0, Math.min(100, progressPercent));

  return (
    <div className="sb-pdms-root" role="region" aria-label="Now playing deck">
      <div className="sb-pdms-panel">
        <div className="sb-pdms-row">
          <span className="sb-pdms-label">Play now</span>
          <span className="sb-pdms-value" title={nowPlayingLabel}>
            {nowPlayingLabel}
          </span>
        </div>
        <div className="sb-pdms-row">
          <span className="sb-pdms-label">Next</span>
          <span className="sb-pdms-value sb-pdms-value--muted" title={nextLabel}>
            {nextLabel}
          </span>
        </div>
      </div>
      <div className="sb-pdms-timeline" aria-hidden>
        <span className="sb-pdms-time">{positionLabel}</span>
        <div className="sb-pdms-bar-track">
          <div className="sb-pdms-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="sb-pdms-time">{durationLabel}</span>
      </div>
      <p className="sb-pdms-timeline-hint">Timeline is a mock until engine (MPV) reports position.</p>
    </div>
  );
}
