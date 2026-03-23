"use client";

import { useState } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { MasterControlConfirmModal } from "@/components/master-control-confirm-modal";
import { SwitchToControlConfirmModal } from "@/components/switch-to-control-confirm-modal";
import { usePlayback } from "@/lib/playback-provider";

/** MASTER / CONTROL mode switch for Settings. Uses same state and handlers as device context. */
export function DeviceModeSettingsSwitch() {
  const ctx = useDevicePlayer();
  const { stop } = usePlayback();
  const [controlConfirmOpen, setControlConfirmOpen] = useState(false);

  if (!ctx?.isBranchConnected) {
    return (
      <p className="text-xs text-slate-500">
        Connect to branch to choose MASTER / CONTROL mode.
      </p>
    );
  }

  const { deviceMode, masterConfirmOpen, setMasterConfirmOpen, sendSetMaster, sendSetControl, hasExistingMaster } = ctx;
  const isMaster = deviceMode === "MASTER";

  const handleMasterClick = () => {
    if (isMaster) return;
    setMasterConfirmOpen(true);
  };

  const handleControlClick = () => {
    if (!isMaster) return;
    setControlConfirmOpen(true);
  };

  const handleMasterConfirm = () => {
    stop();
    sendSetMaster();
  };

  const handleControlConfirm = () => {
    stop();
    sendSetControl();
  };

  return (
    <>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-500">
          Remote player mode
        </label>
        <div
          className="inline-flex rounded-lg border border-slate-700/80 bg-slate-900/60 p-0.5"
          role="group"
          aria-label="Device mode"
        >
          <button
            type="button"
            onClick={handleMasterClick}
            aria-pressed={isMaster}
            aria-label={isMaster ? "MASTER (active)" : "Switch to MASTER"}
            title={isMaster ? "This device is MASTER" : "Switch to MASTER"}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
              isMaster
                ? "border border-red-500/60 bg-red-600/25 text-red-200 shadow-[0_0_12px_rgba(239,68,68,0.2)]"
                : "border border-transparent bg-transparent text-slate-500 hover:bg-slate-800/80 hover:text-slate-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                isMaster ? "bg-red-400 animate-pulse" : "bg-slate-500"
              }`}
            />
            MASTER
          </button>
          <button
            type="button"
            onClick={handleControlClick}
            aria-pressed={!isMaster}
            aria-label={!isMaster ? "CONTROL (active)" : "Switch to CONTROL"}
            title={!isMaster ? "This device is CONTROL" : "Switch to CONTROL"}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
              !isMaster
                ? "border border-amber-500/60 bg-amber-600/20 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
                : "border border-transparent bg-transparent text-slate-500 hover:bg-slate-800/80 hover:text-slate-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                !isMaster ? "bg-amber-400" : "bg-slate-500"
              }`}
            />
            CONTROL
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          {isMaster
            ? "This device outputs audio. Other devices mirror this player."
            : "This device mirrors the MASTER. Use the switch above to become MASTER."}
        </p>
        {!isMaster && hasExistingMaster && (
          <p className="text-[11px] text-amber-400/90">
            Controlling: Branch Master. This device mirrors the main player.
          </p>
        )}
      </div>
      <MasterControlConfirmModal
        isOpen={masterConfirmOpen}
        onClose={() => setMasterConfirmOpen(false)}
        onConfirm={handleMasterConfirm}
      />
      <SwitchToControlConfirmModal
        isOpen={controlConfirmOpen}
        onClose={() => setControlConfirmOpen(false)}
        onConfirm={handleControlConfirm}
      />
    </>
  );
}
