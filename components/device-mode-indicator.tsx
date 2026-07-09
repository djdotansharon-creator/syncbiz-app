"use client";

import { useDevicePlayer } from "@/lib/device-player-context";

/** Small LED-style status indicator for device mode. Read-only, no toggle. */
export function DeviceModeIndicator() {
  const ctx = useDevicePlayer();

  if (!ctx) return null;

  const { deviceMode, hasExistingMaster, isBranchConnected, isObserverOnlyBrowser } = ctx;

  if (isObserverOnlyBrowser) return null;

  /* Not branch-connected: StandaloneIndicator already shows the single
     "Standalone" chip — rendering a second one here duplicated it in the header. */
  if (!isBranchConnected) return null;

  const isMaster = deviceMode === "MASTER";

  return (
    <div className="flex items-center gap-2">
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-[5px] ${
          isMaster
            ? "border-red-500/35 bg-red-500/10"
            : "border-[#0a84ff]/35 bg-[#0a84ff]/10"
        }`}
        role="status"
        aria-label={`Device mode: ${deviceMode}`}
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
          {deviceMode}
        </span>
      </div>
      {!isMaster && hasExistingMaster && (
        <span className="hidden text-[11px] text-[#6e6e73] sm:inline" title="Playback controlled by the branch master player">
          Controlling: Branch Master
        </span>
      )}
    </div>
  );
}
