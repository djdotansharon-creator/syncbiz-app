export type PlaybackDockTransport = {
  onPrev: () => void;
  onStop: () => void;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
  stopDisabled: boolean;
  playDisabled: boolean;
  pauseDisabled: boolean;
};

export type PlaybackDockSurfaceProps =
  | { variant: "empty"; message: string }
  | {
      variant: "active";
      title: string;
      subtitle: string;
      volume: number;
      onVolumeChange: (v: number) => void;
      transport: PlaybackDockTransport;
      /**
       * `readout` — title + subtitle only (e.g. Electron: controls live in `PlayerDeckTransportStripSurface`).
       * `full` or omitted — transport + volume (web `/player` footer).
       */
      footerMode?: "full" | "readout";
    };
