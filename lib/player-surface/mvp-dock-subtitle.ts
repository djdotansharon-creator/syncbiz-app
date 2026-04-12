/** Subset of desktop MVP snapshot needed for dock subtitle — avoids importing from `desktop/`. */
export type MvpSnapshotDockFields = {
  mockVolume: number;
  mockSelectedLibraryId: string | null;
  mockPlaybackStatus: "idle" | "playing" | "paused" | "stopped";
  /** When set, idle dock mirrors the same station context as `PlayerHeroSurface` detail (desktop parity). */
  workspaceLabel?: string;
  branchId?: string;
  wsState?: "disconnected" | "connecting" | "connected" | "error";
  registered?: boolean;
};

function dockStationBit(s: MvpSnapshotDockFields): string {
  const ws = s.workspaceLabel?.trim() || "—";
  const br = s.branchId?.trim() || "default";
  let link = "WS offline";
  if (s.wsState === "connected" && s.registered) link = "WS connected · registered";
  else if (s.wsState === "connecting") link = "WS connecting…";
  else if (s.wsState === "error") link = "WS error";
  else if (s.wsState === "connected") link = "WS connected (not registered)";
  return `${ws} · Branch: ${br} · ${link}`;
}

export function mvpDockSubtitle(s: MvpSnapshotDockFields): string {
  const v = Math.round(s.mockVolume ?? 0);
  const hasSel = Boolean(s.mockSelectedLibraryId);
  if (!hasSel) {
    return `No source selected · ${dockStationBit(s)} · mock transport`;
  }
  const word =
    s.mockPlaybackStatus === "playing"
      ? "Playing"
      : s.mockPlaybackStatus === "paused"
        ? "Paused"
        : s.mockPlaybackStatus === "stopped"
          ? "Stopped"
          : "Idle";
  return `${word} · Volume ${v}%`;
}
