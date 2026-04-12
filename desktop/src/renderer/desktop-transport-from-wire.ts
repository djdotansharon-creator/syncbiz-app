import type { PlaybackDockTransport } from "../../../lib/player-surface/playback-dock-types";
import type { MvpStatusSnapshot } from "../shared/mvp-types";
import type { DesktopHeroWire } from "./map-desktop-hero-props";

/** Mock transport wiring shared by hero + footer `PlaybackDockSurface` (same as web `PlaybackBar`). */
export function desktopMockTransportFromWire(wire: DesktopHeroWire, s: MvpStatusSnapshot): PlaybackDockTransport {
  const navDisabled = (s.branchCatalogCount ?? 0) < 1;
  return {
    onPrev: wire.onPrev,
    onStop: wire.onStop,
    onPlay: wire.onPlay,
    onPause: wire.onPause,
    onNext: wire.onNext,
    prevDisabled: navDisabled,
    nextDisabled: navDisabled,
    stopDisabled: false,
    playDisabled: false,
    pauseDisabled: false,
  };
}
