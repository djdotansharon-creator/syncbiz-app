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
  pendingTransport?: Partial<{
    prev: boolean;
    next: boolean;
    play: boolean;
    pause: boolean;
    stop: boolean;
  }>;
}): Extract<PlaybackDockSurfaceProps, { variant: "active" }> {
  const pending = input.pendingTransport ?? {};
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
      prevDisabled: !input.hasPrevNext || !!pending.prev,
      nextDisabled: !input.hasPrevNext || !!pending.next,
      stopDisabled: !input.hasSource || !!pending.stop,
      playDisabled: !input.hasSource || !!pending.play,
      pauseDisabled: !input.hasSource || !!pending.pause,
    },
  };
}
