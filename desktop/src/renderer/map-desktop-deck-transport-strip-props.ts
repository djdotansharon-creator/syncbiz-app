import type { MvpStatusSnapshot } from "../shared/mvp-types";
import type { DesktopDeckStripActions, PlayerDeckTransportStripSurfaceProps } from "../../../lib/player-surface/player-deck-transport-strip-types";
import type { DesktopHeroWire } from "./map-desktop-hero-props";
import { desktopMockTransportFromWire } from "./desktop-transport-from-wire";

export type DesktopDeckMockToggles = {
  autoMixOn: boolean;
  shuffleOn: boolean;
};

export function buildDesktopDeckTransportStripProps(
  s: MvpStatusSnapshot,
  wire: DesktopHeroWire,
  toggles: DesktopDeckMockToggles,
  actions: DesktopDeckStripActions,
): PlayerDeckTransportStripSurfaceProps {
  const hasSel = Boolean(s.mockSelectedLibraryId);
  return {
    transport: desktopMockTransportFromWire(wire, s),
    volume: Math.round(s.mockVolume ?? 0),
    onVolumeChange: wire.onVolumeChange,
    autoMixOn: toggles.autoMixOn,
    shuffleOn: toggles.shuffleOn,
    onAutoMixToggle: actions.onAutoMixToggle,
    onShuffleToggle: actions.onShuffleToggle,
    extrasDisabled: !hasSel,
    onShareClick: actions.onShareClick,
    shareDisabled: !hasSel,
  };
}
