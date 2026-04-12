/**
 * In-shell deck transport row — shared by `AudioPlayer` (browser + desktop).
 * Timeline/seek stays in the player; this slice is transport + deck volume + share only.
 */

export type PlayerDeckTransportVariant = "library-deck" | "default";

export type PlayerDeckTransportLabels = {
  previousTrack: string;
  stopPlayback: string;
  play: string;
  pausePlayback: string;
  next: string;
  autoMix: string;
  random: string;
  unmute: string;
  mute: string;
  volumeAria: string;
  share: string;
};

export type PlayerDeckTransportSurfaceProps = {
  variant: PlayerDeckTransportVariant;
  onPrev: () => void;
  onStop: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  prevNextDisabled: boolean;
  contentDisabled: boolean;
  /** True while audio is actively playing (play button shows pause affordance). */
  isPlaying: boolean;
  onAutoMixToggle: () => void;
  onShuffleToggle: () => void;
  displayAutoMix: boolean;
  displayShuffle: boolean;
  displayVolume: number;
  onVolumeChange: (value: number) => void;
  /** Mute toggle: parent owns `volumeBeforeMute` ref semantics. */
  onMuteToggle: () => void;
  onShareClick: () => void;
  shareDisabled: boolean;
  labels: PlayerDeckTransportLabels;
};
