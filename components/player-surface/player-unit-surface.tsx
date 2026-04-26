"use client";

import type { ReactNode } from "react";

/**
 * In-shell player layout shell: circular artwork column + primary column (transport,
 * track panel, timeline) + optional right-edge aside. Extracted from `AudioPlayer` so
 * browser and desktop renderers share one structural primitive alongside
 * `PlayerHeroSurface` / `PlaybackDockSurface`.
 *
 * Layout note (right-edge pinning)
 * --------------------------------
 * `rightAside` is the slot used by the vertical mixer-strip VOLUME module. Earlier
 * passes nested everything inside `mx-auto max-w-6xl flex justify-center`, which on
 * wide viewports left a chunky empty band between the volume strip and the
 * Command Pads aside next door — the volume sat at the right edge of the *centered*
 * content, not at the right edge of the *cell*.
 *
 * The current structure is a 3-column CSS grid (`auto · 1fr · auto`) so the
 * artwork column hugs the cell's left padding, the children column flexes in the
 * middle (still capped by `max-w-2xl` on the inner stack so the transport row
 * doesn't sprawl), and the right-aside column hugs the cell's right padding —
 * which butts directly against the Command Pads aside's left border, giving the
 * same "two adjacent cells with their natural padding" rhythm as every other
 * deck-row pair.
 */
export function PlayerUnitSurface(props: {
  artwork: ReactNode;
  children: ReactNode;
  rightAside?: ReactNode;
}) {
  const { artwork, children, rightAside } = props;
  return (
    <div
      className={
        rightAside
          ? // 3-col grid keeps each region pinned to its own track: artwork
            // sticks left, children center within the 1fr middle column, and
            // rightAside sits flush against the cell's right padding so it's
            // adjacent to Command Pads with the same gap rhythm as the rest
            // of the deck row.
            "grid h-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-5 sm:gap-6"
          : // Without rightAside, fall back to the original centered shell so
            // existing non-deck consumers keep their layout.
            "mx-auto flex h-full min-w-0 max-w-6xl items-center justify-center gap-3 sm:gap-5 sm:gap-6"
      }
    >
      <div className="relative flex shrink-0 items-center justify-center">{artwork}</div>
      <div className="mx-auto flex min-w-0 w-full max-w-2xl flex-col gap-2.5">{children}</div>
      {rightAside ? (
        <div className="hidden h-full shrink-0 items-stretch sm:flex">
          {rightAside}
        </div>
      ) : null}
    </div>
  );
}
