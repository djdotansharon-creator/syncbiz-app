"use client";

import { DeviceModeSettingsSwitch } from "@/components/device-mode-settings-switch";

/**
 * MASTER / CONTROL branch controls for dedicated browser player surfaces (`/player`, `/remote-player`).
 * Normal app routes (settings, library, …) do not mount this — they stay observer-only.
 */
export function PlayerBranchModePanel() {
  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-900/45 px-4 py-3">
      <DeviceModeSettingsSwitch />
    </div>
  );
}
