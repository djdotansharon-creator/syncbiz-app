import type { MvpStatusSnapshot } from "../shared/mvp-types";
import type { PlayerHeroSurfaceProps } from "../../../lib/player-surface/player-hero-types";
import { providerLabelFromType } from "../../../lib/player-surface/labels";
import { sourceTypeToIconType } from "../../../lib/player-surface/icon-type";
import { isSafeHttpCoverUrl } from "../../../lib/player-surface/cover-url";

export type DesktopHeroWire = {
  onPlay: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onPrev: () => void;
  onNext: () => void;
  onVolumeChange: (v: number) => void;
};

function desktopBranchStationDetail(s: MvpStatusSnapshot): string {
  const ws = s.workspaceLabel?.trim() || "—";
  const br = s.branchId?.trim() || "default";
  let link = "WS offline";
  if (s.wsState === "connected" && s.registered) link = "WS connected · registered";
  else if (s.wsState === "connecting") link = "WS connecting…";
  else if (s.wsState === "error") link = "WS error";
  else if (s.wsState === "connected") link = "WS connected (not registered)";
  return `Workspace: ${ws} · Branch: ${br} · ${link}. Pick a row in Library to load now-playing context.`;
}

export function mvpSnapshotToPlayerHeroProps(
  s: MvpStatusSnapshot,
  wire: DesktopHeroWire,
): PlayerHeroSurfaceProps {
  const hasSel = Boolean(s.mockSelectedLibraryId);
  const navDisabled = (s.branchCatalogCount ?? 0) < 1;
  if (!hasSel) {
    /** Same chrome as web `/player` embedded hero: inline transport + volume + fixed `PlaybackBar`-class footer. */
    return {
      variant: "active",
      active: {
        heroEyebrow: "Branch player",
        title: "No track loaded",
        providerLabel: "Mock playback — engine not connected yet",
        detailLine: desktopBranchStationDetail(s),
        status: s.mockPlaybackStatus,
        artworkUrl: null,
        iconType: sourceTypeToIconType(s.mockSelectedSourceType),
        volume: Math.round(s.mockVolume ?? 0),
        onVolumeChange: wire.onVolumeChange,
        transport: {
          onPrev: wire.onPrev,
          onStop: wire.onStop,
          onPlay: wire.onPlay,
          onPause: wire.onPause,
          onNext: wire.onNext,
          prevDisabled: navDisabled,
          nextDisabled: navDisabled,
          playDisabled: false,
          pauseDisabled: false,
        },
      },
    };
  }

  const kind = s.mockSelectedLibraryKind ?? "—";
  const typ = s.mockSelectedSourceType ?? "—";
  const detailLine = `Source · ${kind} · ${typ} · branch ${s.branchId}`;

  const cover = isSafeHttpCoverUrl(s.mockCurrentSourceCoverUrl) ? s.mockCurrentSourceCoverUrl : null;

  return {
    variant: "active",
    active: {
      heroEyebrow: "Now playing",
      title: s.mockCurrentSourceLabel?.trim() || "—",
      providerLabel: providerLabelFromType(s.mockSelectedSourceType),
      detailLine,
      status: s.mockPlaybackStatus,
      artworkUrl: cover,
      iconType: sourceTypeToIconType(s.mockSelectedSourceType),
      volume: Math.round(s.mockVolume ?? 0),
      onVolumeChange: wire.onVolumeChange,
      transport: {
        onPrev: wire.onPrev,
        onStop: wire.onStop,
        onPlay: wire.onPlay,
        onPause: wire.onPause,
        onNext: wire.onNext,
        prevDisabled: navDisabled,
        nextDisabled: navDisabled,
        playDisabled: false,
        pauseDisabled: false,
      },
    },
  };
}
