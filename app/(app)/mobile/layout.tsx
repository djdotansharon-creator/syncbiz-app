"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { StationControllerProvider } from "@/lib/station-controller-context";
import { MobileSourcesProvider } from "@/lib/mobile-sources-context";
import {
  MobileNowPlayingContext,
  type NowPlayingContextValue,
} from "@/lib/mobile-now-playing-context";
import { MobileBottomNav } from "@/components/mobile/mobile-bottom-nav";
import { MobileMiniPlayer } from "@/components/mobile/mobile-mini-player";
import { MobileNowPlayingSheet } from "@/components/mobile/mobile-now-playing-sheet";

/**
 * Persistent mobile shell. Every mobile tab mounts inside this layout, which:
 *   - mounts `StationControllerProvider` once (single controller WS across tab nav)
 *   - mounts `MobileSourcesProvider` once (library loaded once, reused on every tab)
 *   - pins the mini-player `top-card` at the TOP of every mobile page
 *     (/mobile/home, /mobile/library, /mobile/search, /mobile/remote,
 *     /mobile/scheduling) so the player surface is in one consistent
 *     position across the whole mobile app — matches the "Connect a player"
 *     rectangle the user asked to live at the top of the design
 *   - pins the 4-tab bottom nav to the viewport
 *   - owns the Now Playing sheet and its open/close state (shared via
 *     `MobileNowPlayingContext` so pages can trigger it if needed)
 *
 * The scrollable page content is the `children` slot in the middle column.
 * Pages should NOT render their own fixed footer/nav and should NOT render
 * their own mini-player — the layout owns both.
 */
export default function MobileLayout({ children }: { children: ReactNode }) {
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const openNowPlaying = useCallback(() => setNowPlayingOpen(true), []);
  const closeNowPlaying = useCallback(() => setNowPlayingOpen(false), []);

  const ctxValue = useMemo<NowPlayingContextValue>(
    () => ({ openNowPlaying }),
    [openNowPlaying],
  );

  return (
    <StationControllerProvider>
      <MobileSourcesProvider>
        <MobileNowPlayingContext.Provider value={ctxValue}>
          <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-950 text-slate-100">
            <div className="shrink-0 px-4 pt-3 pb-2">
              <MobileMiniPlayer onOpen={openNowPlaying} variant="top-card" />
            </div>
            <main className="flex-1 overflow-y-auto overscroll-contain">{children}</main>
            <div className="shrink-0">
              <MobileBottomNav />
            </div>
          </div>
          <MobileNowPlayingSheet open={nowPlayingOpen} onClose={closeNowPlaying} />
        </MobileNowPlayingContext.Provider>
      </MobileSourcesProvider>
    </StationControllerProvider>
  );
}
