"use client";

import { useDevicePlayer } from "@/lib/device-player-context";

/** Shown when on desktop but not branch-connected (unauthenticated or disconnected). */
export function StandaloneIndicator() {
  const ctx = useDevicePlayer();
  if (!ctx?.isActive || ctx?.isBranchConnected) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-[5px] text-[11px] font-medium uppercase tracking-wider text-[#6e6e73]"
      role="status"
      aria-label="Standalone mode"
      title="Local playback only. Sign in to sync across devices."
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#6e6e73]" />
      Standalone
    </span>
  );
}
