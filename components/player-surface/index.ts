/**
 * Shared browser/desktop player + library browsing primitives.
 * Prefer importing from here for parity work; existing deep imports remain valid.
 */
export { BranchLibraryBrowseCard } from "./branch-library-browse-card";
export { BranchLibraryGrid } from "./branch-library-grid";
export { DenseDataRowSurface } from "./dense-data-row-surface";
export { PlayerDeckMetaStripSurface } from "./player-deck-meta-strip-surface";
export { PlayerDeckTransportStripSurface } from "./player-deck-transport-strip-surface";
export { LibraryBrowseCardSurface } from "./library-browse-card-surface";
export { LibraryBrowseRowSurface } from "./library-browse-row-surface";
export { PlaybackDockSurface } from "./playback-dock-surface";
export {
  PlaybackTransportIconNext,
  PlaybackTransportIconPause,
  PlaybackTransportIconPlay,
  PlaybackTransportIconPrev,
  PlaybackTransportIconStop,
  PlaybackTransportIconVolume,
  PlaybackTransportIconVolumeMuted,
} from "./playback-transport-icons";
export { PlayerDeckTransportSurface } from "./player-deck-transport-surface";
export { PlayerHeroSurface } from "./player-hero-surface";
export { PlayerUnitSurface } from "./player-unit-surface";
export type {
  PlayerDeckTransportLabels,
  PlayerDeckTransportSurfaceProps,
  PlayerDeckTransportVariant,
} from "../../lib/player-surface/player-deck-transport-types";
export type { PlayerDeckMetaStripSurfaceProps } from "../../lib/player-surface/player-deck-meta-strip-types";
export type {
  DesktopDeckStripActions,
  PlayerDeckTransportStripSurfaceProps,
} from "../../lib/player-surface/player-deck-transport-strip-types";
