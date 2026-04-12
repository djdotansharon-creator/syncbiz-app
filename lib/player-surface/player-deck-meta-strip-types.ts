/**
 * Read-only deck strip — mirrors browser AudioPlayer ROW2+ROW3 layout intent for Electron (sb-* CSS only).
 */

export type PlayerDeckMetaStripSurfaceProps = {
  nowPlayingLabel: string;
  nextLabel: string;
  positionLabel: string;
  durationLabel: string;
  /** 0–100 for progress fill */
  progressPercent: number;
};
