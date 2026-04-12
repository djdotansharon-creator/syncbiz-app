import type { MvpStatusSnapshot } from "../shared/mvp-types";
import type { PlayerDeckMetaStripSurfaceProps } from "../../../lib/player-surface/player-deck-meta-strip-types";

/** Maps MVP snapshot to read-only deck strip (PLAY NOW / NEXT / timeline placeholder). */
export function mvpSnapshotToDeckMetaStripProps(s: MvpStatusSnapshot): PlayerDeckMetaStripSurfaceProps {
  const hasSel = Boolean(s.mockSelectedLibraryId);
  const nowPlayingLabel = hasSel ? s.mockCurrentSourceLabel?.trim() || "—" : "No track loaded";
  const progressPercent =
    s.mockPlaybackStatus === "playing" ? 38 : s.mockPlaybackStatus === "paused" ? 18 : 0;

  return {
    nowPlayingLabel,
    nextLabel: "—",
    positionLabel: "0:00",
    durationLabel: "--:--",
    progressPercent,
  };
}
