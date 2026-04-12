"use client";

import type { ReactNode } from "react";

/**
 * In-shell player layout shell: circular artwork column + primary column (transport,
 * track panel, timeline). Extracted from `AudioPlayer` so browser and desktop renderers
 * share one structural primitive alongside `PlayerHeroSurface` / `PlaybackDockSurface`.
 */
export function PlayerUnitSurface(props: { artwork: ReactNode; children: ReactNode }) {
  const { artwork, children } = props;
  return (
    <div className="mx-auto flex min-w-0 max-w-6xl justify-center">
      <div className="flex min-w-0 items-center gap-3 sm:gap-5 sm:gap-6">
        <div className="relative flex shrink-0 items-center justify-center">{artwork}</div>
        <div className="flex min-w-0 w-full max-w-2xl flex-1 flex-col gap-2.5">{children}</div>
      </div>
    </div>
  );
}
