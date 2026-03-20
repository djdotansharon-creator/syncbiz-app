"use client";

import { useDevicePlayer } from "@/lib/device-player-context";

/** Shown when on desktop but not branch-connected (unauthenticated or disconnected). */
export function StandaloneIndicator() {
  const ctx = useDevicePlayer();
  if (!ctx?.isActive || ctx?.isBranchConnected) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600/60 bg-slate-800/40 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500"
      role="status"
      aria-label="Standalone mode"
      title="Local playback only. Sign in to sync across devices."
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
      Standalone
    </span>
  );
}
