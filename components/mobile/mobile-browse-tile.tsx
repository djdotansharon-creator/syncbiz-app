"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  label: string;
  href: string;
  /** Tailwind bg gradient tokens, e.g. "from-sky-500 to-cyan-600". */
  gradient: string;
  icon?: ReactNode;
};

/**
 * Large colored tile used on Home / Search browse grids. Matches the Spotify 2x2 grid
 * hierarchy from the reference screenshots: solid colored background, heading text in
 * the upper-right (RTL) / upper-left (LTR), decorative icon in the lower area.
 */
export function MobileBrowseTile({ label, href, gradient, icon }: Props) {
  return (
    <Link
      href={href}
      className={`relative flex h-24 items-start overflow-hidden rounded-xl bg-gradient-to-br ${gradient} px-3 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_10px_rgba(0,0,0,0.25)] transition active:scale-[0.98]`}
    >
      <span className="relative z-10 w-full leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
        {label}
      </span>
      {icon && (
        <span className="pointer-events-none absolute -bottom-2 -right-2 rotate-[18deg] opacity-85 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]">
          {icon}
        </span>
      )}
    </Link>
  );
}
