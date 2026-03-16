"use client";

import { useDevicePlayer } from "@/lib/device-player-context";
import { MasterControlConfirmModal } from "@/components/master-control-confirm-modal";
import { usePlayback } from "@/lib/playback-provider";

export function DeviceModeHeaderButtons() {
  const ctx = useDevicePlayer();
  const { stop } = usePlayback();

  if (!ctx?.isActive) return null;

  const { deviceMode, masterConfirmOpen, setMasterConfirmOpen, sendSetMaster, sendSetControl } = ctx;
  const isMaster = deviceMode === "MASTER";

  const handleMasterClick = () => {
    if (isMaster) return;
    setMasterConfirmOpen(true);
  };

  const handleControlClick = () => {
    if (!isMaster) return;
    stop();
    sendSetControl();
  };

  const handleMasterConfirm = () => {
    stop();
    sendSetMaster();
  };

  return (
    <>
      <div className="flex items-center gap-1.5" role="group" aria-label="Device mode">
        {isMaster ? (
          <>
            {/* D: MASTER mode – prominent red ON AIR indicator */}
            <button
              type="button"
              onClick={handleMasterClick}
              aria-pressed
              aria-label="MASTER"
              title="This device is MASTER (active audio output)"
              className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all border-2 border-red-500/80 bg-red-600/30 text-red-200 shadow-[0_0_16px_rgba(239,68,68,0.4),0_0_32px_rgba(239,68,68,0.2)]"
            >
              <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
              MASTER
            </button>
            <button
              type="button"
              onClick={handleControlClick}
              aria-pressed={false}
              aria-label="CONTROL"
              title="Switch to CONTROL"
              className="inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all border border-slate-600/60 bg-slate-800/60 text-slate-400 hover:border-amber-500/40 hover:bg-amber-500/15 hover:text-amber-200"
            >
              <span className="mr-1 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
              CONTROL
            </button>
          </>
        ) : (
          <>
            {/* CONTROL mode – CONTROL prominent, MASTER as premium secondary escalation */}
            <button
              type="button"
              onClick={handleControlClick}
              aria-pressed
              aria-label="CONTROL"
              title="This device is CONTROL (mirroring master)"
              className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all border border-amber-500/60 bg-amber-600/20 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.25)]"
            >
              <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.7)]" />
              CONTROL
            </button>
            <button
              type="button"
              onClick={handleMasterClick}
              aria-label="Switch to MASTER"
              title="Switch to MASTER"
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-600/40 bg-slate-800/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-all hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus:ring-1 focus:ring-slate-500/30 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              MASTER
            </button>
          </>
        )}
      </div>
      <MasterControlConfirmModal
        isOpen={masterConfirmOpen}
        onClose={() => setMasterConfirmOpen(false)}
        onConfirm={handleMasterConfirm}
      />
    </>
  );
}
