"use client";

import { useDevicePlayer } from "@/lib/device-player-context";

/** Shown when on desktop but not branch-connected (unauthenticated or disconnected). */
export function StandaloneIndicator() {
  const ctx = useDevicePlayer();
  if (!ctx?.isActive || ctx?.isBranchConnected) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/40 bg-slate-800/50 px-2.5 py-[5px] text-[11px] font-semibold uppercase tracking-wider text-slate-400"
      role="status"
      aria-label="Standalone mode"
      title="Local playback only. Sign in to sync across devices."
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-slate-500 shadow-[0_0_5px_rgba(148,163,184,0.4)]" />
      Standalone
    </span>
  );
}
