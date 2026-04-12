import type { MvpStatusSnapshot } from "../shared/mvp-types";
import type { PlaybackDockSurfaceProps } from "../../../lib/player-surface/playback-dock-types";
import { mvpDockSubtitle } from "../../../lib/player-surface/mvp-dock-subtitle";
import type { DesktopHeroWire } from "./map-desktop-hero-props";
import { desktopMockTransportFromWire } from "./desktop-transport-from-wire";

export function mvpSnapshotToPlaybackDockProps(
  s: MvpStatusSnapshot,
  wire: DesktopHeroWire,
): PlaybackDockSurfaceProps {
  const hasSel = Boolean(s.mockSelectedLibraryId);
  const title = hasSel ? s.mockCurrentSourceLabel?.trim() || "—" : "No source selected";

  return {
    variant: "active",
    title,
    subtitle: mvpDockSubtitle(s),
    volume: Math.round(s.mockVolume ?? 0),
    onVolumeChange: wire.onVolumeChange,
    transport: desktopMockTransportFromWire(wire, s),
  };
}
