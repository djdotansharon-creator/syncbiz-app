/**
 * Global type declarations for YouTube IFrame API and SoundCloud Widget.
 * Used by audio-player, embedded-player, player-page, syncbiz-player-unified.
 */

interface YTPlayerTarget {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  setVolume: (vol: number) => void;
  getVolume: () => number;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
}

export interface SCWidget {
  play: () => void;
  pause: () => void;
  seekTo: (ms: number) => void;
  setVolume: (vol: number) => void;
  getPosition: (cb: (ms: number) => void) => void;
  getDuration: (cb: (ms: number) => void) => void;
  getVolume?: (cb: (vol: number) => void) => void;
  bind: (event: string, cb: () => void) => void;
  unbind?: (event: string) => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string;
          width?: number;
          height?: number;
          playerVars?: Record<string, unknown>;
          events?: { onReady?: (e: { target: YTPlayerTarget }) => void };
        },
      ) => unknown;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
    SC?: {
      Widget: (el: HTMLIFrameElement) => SCWidget;
    };
  }
}

export {};
