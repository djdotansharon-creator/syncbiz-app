"use client";

import { useStationBadge } from "@/components/device-mode-indicator";

/**
 * Shown when on desktop/web but not branch-connected (unauthenticated or disconnected). NEVER on the designated
 * audio station — that machine is the store audio MASTER regardless of its renderer's WS link (display only).
 */
export function StandaloneIndicator() {
  const badge = useStationBadge();
  if (badge.kind !== "standalone") return null;
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
