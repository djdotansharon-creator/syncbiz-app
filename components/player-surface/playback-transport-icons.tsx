/**
 * Single source of truth for playback transport + volume glyph paths shared by
 * `PlaybackDockSurface` and `AudioPlayer` deck controls (visual parity).
 */

export function PlaybackTransportIconPrev({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M6.8 7.4v9.2" fill="none" strokeWidth="2.6" />
      <path d="M17.6 7.8v8.4L10.2 12z" />
    </svg>
  );
}

export function PlaybackTransportIconStop({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
      <rect x="7.4" y="7.4" width="9.2" height="9.2" rx="2.4" />
    </svg>
  );
}

export function PlaybackTransportIconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

export function PlaybackTransportIconPause({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

export function PlaybackTransportIconNext({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M17.2 7.4v9.2" fill="none" strokeWidth="2.6" />
      <path d="M6.4 7.8v8.4L13.8 12z" />
    </svg>
  );
}

/** Unmuted / volume-on (matches dock footer volume icon). */
export function PlaybackTransportIconVolume({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
    </svg>
  );
}

/** Muted (deck mute button; dock has no empty state). */
export function PlaybackTransportIconVolumeMuted({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

/** ONE icon for play + pause (owner 2026-10-18): the play triangle is cut into two pieces that glide into the two pause
 *  bars and back (CSS `d` morph, `.sb-pp` in globals.css) — no circle, white, no crossfade. The paths are the fallback
 *  for engines without CSS `d` animation. */
export function PlaybackTransportIconPlayPause({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <svg
      className={`sb-pp${className ? ` ${className}` : ""}`}
      data-playing={playing ? "1" : "0"}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinejoin="round"
      aria-hidden
    >
      <path className="sb-pp-l" d={playing ? "M7.8 7L9 7L9 17L7.8 17Z" : "M9.2 7.4L13.4 10L13.4 14L9.2 16.6Z"} />
      <path className="sb-pp-r" d={playing ? "M15 7L16.2 7L16.2 17L15 17Z" : "M12.8 9.6L16.6 12L16.6 12L12.8 14.4Z"} />
    </svg>
  );
}
