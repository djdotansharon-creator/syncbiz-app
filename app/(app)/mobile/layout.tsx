"use client";

import type { ReactNode } from "react";
import { StationControllerProvider } from "@/lib/station-controller-context";
import { MobileSourcesProvider } from "@/lib/mobile-sources-context";
import { MobileBottomNav } from "@/components/mobile/mobile-bottom-nav";
import { MobileMiniPlayer } from "@/components/mobile/mobile-mini-player";

/**
 * Persistent mobile shell. Every mobile tab mounts inside this layout, which:
 *   - mounts `StationControllerProvider` once (single controller WS across tab nav)
 *   - mounts `MobileSourcesProvider` once (library loaded once, reused on every tab)
 *   - pins a mini-player + 4-tab bottom nav to the viewport
 *
 * The scrollable page content is the `children` slot in the middle column. Pages should NOT
 * render their own fixed footer/nav — the layout owns that.
 */
export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <StationControllerProvider>
      <MobileSourcesProvider>
        <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-950 text-slate-100">
          <main className="flex-1 overflow-y-auto overscroll-contain">{children}</main>
          <div className="shrink-0">
            <MobileMiniPlayer />
            <MobileBottomNav />
          </div>
        </div>
      </MobileSourcesProvider>
    </StationControllerProvider>
  );
}
