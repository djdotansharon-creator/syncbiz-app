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
  edit: string;
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
  /**
   * Edit button href — navigates to the source editor for the currently-
   * playing track (`/sources/[id]/edit`, `/playlists/[id]/edit`, or
   * `/radio/[id]/edit`). When `null`, the Edit button is hidden (e.g. no
   * catalog id, control mirror, or non-editable source). This is the
   * fallback when `onEditClick` is not provided.
   */
  editHref: string | null;
  /**
   * Alternative to `editHref` — when provided, the Edit button renders
   * as a `<button>` and invokes this handler instead of navigating. Used
   * on routes that host the center workspace panel (library) so editing
   * opens inline without leaving the current page. If both are set,
   * `onEditClick` wins.
   */
  onEditClick?: (() => void) | null;
  labels: PlayerDeckTransportLabels;
};
