import type { PlaybackDockSurfaceProps } from "@/lib/player-surface/playback-dock-types";

/** Maps browser PlaybackBar state (already computed strings) to shared dock props. */
export function buildBrowserPlaybackDockProps(input: {
  title: string;
  subtitle: string;
  volume: number;
  onVolumeChange: (v: number) => void;
  hasSource: boolean;
  hasPrevNext: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  prev: () => void;
  next: () => void;
}): Extract<PlaybackDockSurfaceProps, { variant: "active" }> {
  return {
    variant: "active",
    title: input.title,
    subtitle: input.subtitle,
    volume: input.volume,
    onVolumeChange: input.onVolumeChange,
    transport: {
      onPrev: input.prev,
      onStop: input.stop,
      onPlay: input.play,
      onPause: input.pause,
      onNext: input.next,
      prevDisabled: !input.hasPrevNext,
      nextDisabled: !input.hasPrevNext,
      stopDisabled: !input.hasSource,
      playDisabled: !input.hasSource,
      pauseDisabled: !input.hasSource,
    },
  };
}
