import type { SourceIconType } from "@/lib/player-utils";

/** Shared playback presentation — browser + desktop map their runtimes here. */
export type HeroPlaybackStatus =
  | "playing"
  | "paused"
  | "stopped"
  | "loading"
  | "idle";

export type PlayerHeroTransportHandlers = {
  onPrev: () => void;
  onStop: () => void;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  playDisabled?: boolean;
  pauseDisabled?: boolean;
};

export type PlayerHeroSurfaceProps =
  | {
      variant: "empty";
      empty: {
        title: string;
        body: string;
        hint?: string;
      };
    }
  | {
      variant: "active";
      active: {
        /** Small uppercase label above the title (e.g. BRANCH PLAYER / NOW PLAYING). */
        heroEyebrow?: string;
        title: string;
        providerLabel: string;
        detailLine?: string;
        status: HeroPlaybackStatus;
        artworkUrl: string | null;
        iconType: SourceIconType;
        volume: number;
        onVolumeChange: (v: number) => void;
        transport: PlayerHeroTransportHandlers;
        /** When true, inline transport + volume below meta are not rendered (alternate layouts only). */
        hideInlineTransportAndVolume?: boolean;
      };
    };
