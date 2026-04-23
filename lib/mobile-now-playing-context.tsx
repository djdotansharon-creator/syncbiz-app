"use client";

import { createContext, useContext } from "react";

/**
 * Exposes the mobile layout's `openNowPlaying` callback to any page inside
 * `/mobile/*`. The layout is the single owner of the Now Playing sheet's
 * open state; pages use this context to trigger it (e.g. from the home
 * page's inline mini-player hero).
 */
export type NowPlayingContextValue = { openNowPlaying: () => void };

export const MobileNowPlayingContext = createContext<NowPlayingContextValue | null>(null);

export function useMobileNowPlaying(): NowPlayingContextValue {
  const ctx = useContext(MobileNowPlayingContext);
  if (!ctx) {
    throw new Error("useMobileNowPlaying must be used inside the mobile layout");
  }
  return ctx;
}
