"use client";

import type { ReactNode } from "react";
import { MobileSourcesProvider } from "@/lib/mobile-sources-context";
import { MobileFleetProvider } from "@/lib/mobile-fleet";
import { VmShell } from "@/components/vm/vm-ui";

/**
 * The phone app's persistent shell (redesigned 2026-11-16 — see components/vm/ and app/mobile-app.css).
 *
 *   - ONE live connection for the whole app (`MobileFleetProvider`): every branch the person may see + the last state of each branch's station.
 *     The phone is a REMOTE: it never plays audio itself and never registers as a player (CLAUDE.md §11).
 *   - the library is read once (`MobileSourcesProvider`) and reused by every tab
 *   - the glass tab bar, the floating mini-player and the Now Playing sheet live in `VmShell` and stay mounted across tabs
 */
export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <MobileFleetProvider>
      <MobileSourcesProvider>
        <VmShell>{children}</VmShell>
      </MobileSourcesProvider>
    </MobileFleetProvider>
  );
}
