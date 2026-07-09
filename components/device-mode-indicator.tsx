"use client";

import { useDevicePlayer } from "@/lib/device-player-context";

/** Small LED-style status indicator for device mode. Read-only, no toggle. */
export function DeviceModeIndicator() {
  const ctx = useDevicePlayer();

  if (!ctx) return null;

  const { deviceMode, hasExistingMaster, isBranchConnected, isObserverOnlyBrowser } = ctx;

  if (isObserverOnlyBrowser) return null;

  if (!isBranchConnected) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-full border border-slate-600/50 bg-slate-800/50 px-2.5 py-[5px]"
        role="status"
        aria-label="Device mode: Standalone"
        title="Not connected to branch. Playing locally only."
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-slate-500 shadow-[0_0_5px_rgba(148,163,184,0.4)]" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Standalone</span>
      </div>
    );
  }

  const isMaster = deviceMode === "MASTER";

  return (
    <div className="flex items-center gap-2">
      <div
        className={`inline-flex items-center gap-2 rounded-full px-2.5 py-[5px] ${
          isMaster
            ? "border-2 border-red-500/70 bg-red-600/15 shadow-[0_0_14px_rgba(239,68,68,0.3)]"
            : "border border-amber-500/50 bg-amber-600/12 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
        }`}
        role="status"
        aria-label={`Device mode: ${deviceMode}`}
        title={isMaster ? "MASTER (active audio output)" : "CONTROL (mirroring master)"}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            isMaster
              ? "animate-pulse bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.9),0_0_14px_rgba(239,68,68,0.5)]"
              : "bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.8),0_0_10px_rgba(245,158,11,0.4)]"
          }`}
        />
        <span
          className={`text-[11px] font-bold uppercase tracking-wider ${
            isMaster ? "text-red-200" : "text-amber-200"
          }`}
        >
          {deviceMode}
        </span>
      </div>
      {!isMaster && hasExistingMaster && (
        <span className="hidden text-[11px] text-amber-400/90 sm:inline" title="Playback controlled by the branch master player">
          Controlling: Branch Master
        </span>
      )}
    </div>
  );
}
