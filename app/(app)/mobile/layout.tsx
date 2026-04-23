"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
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
 *   - pins a 4-tab bottom nav to the viewport
 *   - owns the Now Playing sheet and its open/close state (shared via context)
 *   - renders a pinned mini-player above the bottom nav on every tab
 *     EXCEPT `/mobile/home`, where the home page renders the mini-player at
 *     the TOP of its content as part of the page hero. This avoids duplicate
 *     controls and keeps Home visually anchored by the player, while other
 *     tabs keep the familiar Spotify-like bottom dock.
 *
 * The scrollable page content is the `children` slot in the middle column.
 * Pages should NOT render their own fixed footer/nav — the layout owns that.
 */
export default function MobileLayout({ children }: { children: ReactNode }) {
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const openNowPlaying = useCallback(() => setNowPlayingOpen(true), []);
  const closeNowPlaying = useCallback(() => setNowPlayingOpen(false), []);

  const pathname = usePathname();
  const isHome = pathname === "/mobile/home" || pathname === "/mobile";

  const ctxValue = useMemo<NowPlayingContextValue>(
    () => ({ openNowPlaying }),
    [openNowPlaying],
  );

  return (
    <StationControllerProvider>
      <MobileSourcesProvider>
        <MobileNowPlayingContext.Provider value={ctxValue}>
          <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-950 text-slate-100">
            <main className="flex-1 overflow-y-auto overscroll-contain">{children}</main>
            <div className="shrink-0">
              {!isHome && <MobileMiniPlayer onOpen={openNowPlaying} />}
              <MobileBottomNav />
            </div>
          </div>
          <MobileNowPlayingSheet open={nowPlayingOpen} onClose={closeNowPlaying} />
        </MobileNowPlayingContext.Provider>
      </MobileSourcesProvider>
    </StationControllerProvider>
  );
}
