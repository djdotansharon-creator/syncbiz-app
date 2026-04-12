import type { Source } from "@/lib/types";
import type { SourceIconType } from "@/lib/player-utils";
import type { PlayerHeroSurfaceProps } from "@/lib/player-surface/player-hero-types";

type RuntimeStatus = "playing" | "paused" | "stopped" | "loading" | "idle";

export function buildBrowserEmbeddedHeroProps(input: {
  source: Source;
  providerLabel: string;
  iconType: SourceIconType;
  artworkUrl: string | null;
  status: RuntimeStatus;
  volume: number;
  onVolumeChange: (v: number) => void;
  onPrev: () => void;
  onStop: () => void;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
}): PlayerHeroSurfaceProps {
  return {
    variant: "active",
    active: {
      title: input.source.name,
      providerLabel: input.providerLabel,
      status: input.status,
      artworkUrl: input.artworkUrl,
      iconType: input.iconType,
      volume: input.volume,
      onVolumeChange: input.onVolumeChange,
      transport: {
        onPrev: input.onPrev,
        onStop: input.onStop,
        onPlay: input.onPlay,
        onPause: input.onPause,
        onNext: input.onNext,
        prevDisabled: false,
        nextDisabled: false,
        playDisabled: input.status === "loading",
        pauseDisabled: input.status === "loading",
      },
    },
  };
}
