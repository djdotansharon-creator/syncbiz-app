"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  label: string;
  href: string;
  /** Tailwind bg gradient tokens, e.g. "from-sky-500 to-cyan-600". */
  gradient: string;
  icon?: ReactNode;
  /** Optional secondary label rendered under the title (e.g. "Playlists, tracks & more"). */
  subtitle?: string;
};

/**
 * Large colored tile used on Home / Search browse grids.
 *
 * Hierarchy target: heading top-left, optional subtitle underneath, decorative
 * icon anchored in the bottom-right corner. Inspired by Spotify's 2×2 browse
 * grid density, but with SyncBiz color tokens and typography — do not copy
 * Spotify's iconography here.
 */
export function MobileBrowseTile({ label, href, gradient, icon, subtitle }: Props) {
  return (
    <Link
      href={href}
      className={`group relative flex h-28 flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br ${gradient} px-3 py-2.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_14px_-2px_rgba(0,0,0,0.35)] transition active:scale-[0.98]`}
    >
      <div className="relative z-10 min-w-0">
        <p className="truncate text-[15px] font-semibold leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
          {label}
        </p>
        {subtitle && (
          <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug text-white/80">
            {subtitle}
          </p>
        )}
      </div>
      {icon && (
        <span className="pointer-events-none absolute bottom-1 right-1 rotate-[20deg] text-white/90 drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)] transition-transform group-active:rotate-[14deg]">
          {icon}
        </span>
      )}
      {/* Soft inner glow in the top-right for a premium, non-flat feel. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl"
      />
    </Link>
  );
}
