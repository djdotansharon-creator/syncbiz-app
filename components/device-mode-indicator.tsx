"use client";

import { useDevicePlayer } from "@/lib/device-player-context";
import { usePlaybackOptional } from "@/lib/playback-provider";
import { resolveStationBadge, type StationBadge } from "@/components/station-badge-logic";

/** Shared DISPLAY-ONLY station badge decision for the header chips (no playback / WS side effects). */
export function useStationBadge(): StationBadge {
  const ctx = useDevicePlayer();
  const playback = usePlaybackOptional(); // read-only; never throws in the header
  if (!ctx) return { kind: "hidden" };
  const isElectronShell = typeof window !== "undefined" && "syncbizDesktop" in window;
  // Playing = the renderer's own session (LOCAL on the station) OR the station MAIN's published state (URL / remote).
  const isPlaying = playback?.status === "playing" || ctx.masterState?.status === "playing";
  return resolveStationBadge({
    isActive: ctx.isActive,
    isElectronShell,
    isDesignatedAudioStation: ctx.isDesignatedAudioStation,
    mainSnapResolved: ctx.mainSnapResolved,
    isBranchConnected: ctx.isBranchConnected,
    isObserverOnlyBrowser: ctx.isObserverOnlyBrowser,
    deviceMode: ctx.deviceMode,
    hasExistingMaster: ctx.hasExistingMaster,
    isPlaying,
  });
}

/** Small LED-style status indicator for the device's user-facing role. Read-only, no toggle. */
export function DeviceModeIndicator() {
  const badge = useStationBadge();

  if (badge.kind === "station-master") {
    // GREEN — this physical computer is the designated station that outputs the store audio.
    return (
      <div className="flex items-center gap-2">
        <div
          className="inline-flex items-center gap-2 rounded-full border border-[#30d158]/35 bg-[#30d158]/10 px-2.5 py-[5px]"
          role="status"
          aria-label="Device mode: MASTER (this computer plays the store audio)"
          title="MASTER — this computer is the store audio station"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#30d158]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7ee2a0]">MASTER</span>
        </div>
        <span className="hidden text-[11px] text-[#a1a1a6] sm:inline">{badge.subline}</span>
      </div>
    );
  }

  if (badge.kind !== "ws-master" && badge.kind !== "control") return null;
  const isMaster = badge.kind === "ws-master";
  const label = isMaster ? "MASTER" : "CONTROL";

  return (
    <div className="flex items-center gap-2">
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-[5px] ${
          isMaster
            ? "border-red-500/35 bg-red-500/10"
            : "border-[#0a84ff]/35 bg-[#0a84ff]/10"
        }`}
        role="status"
        aria-label={`Device mode: ${label}`}
        title={isMaster ? "MASTER (active audio output)" : "CONTROL (mirroring master)"}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${isMaster ? "bg-red-400" : "bg-[#409cff]"}`}
        />
        <span
          className={`text-[11px] font-semibold uppercase tracking-wider ${
            isMaster ? "text-red-300" : "text-[#7db8ff]"
          }`}
        >
          {label}
        </span>
      </div>
      {badge.kind === "control" && badge.subline && (
        <span className="hidden text-[11px] text-[#6e6e73] sm:inline" title="Playback controlled by the branch master player">
          {badge.subline}
        </span>
      )}
    </div>
  );
}
