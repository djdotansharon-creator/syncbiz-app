import type { PlaybackDockTransport } from "./playback-dock-types";

export type DesktopDeckStripActions = {
  onAutoMixToggle: () => void;
  onShuffleToggle: () => void;
  onShareClick: () => void;
};

/** In-card deck: transport + mock automix/shuffle + volume + share (Electron-first; Tailwind-free). */
export type PlayerDeckTransportStripSurfaceProps = {
  transport: PlaybackDockTransport;
  volume: number;
  onVolumeChange: (v: number) => void;
  autoMixOn: boolean;
  shuffleOn: boolean;
  onAutoMixToggle: () => void;
  onShuffleToggle: () => void;
  /** Automix + shuffle need a loaded station source (mirrors browser deck). */
  extrasDisabled: boolean;
  onShareClick: () => void;
  shareDisabled: boolean;
};
