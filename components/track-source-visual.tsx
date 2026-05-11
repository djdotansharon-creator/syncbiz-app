"use client";

import type { ReactElement } from "react";

export type { TrackSourceChip } from "@/lib/track-source-chip";
export { inferTrackSourceChip } from "@/lib/track-source-chip";

import type { TrackSourceChip } from "@/lib/track-source-chip";

const CHIP_META: Record<
  TrackSourceChip,
  { label: string; badgeBg: string; badgeText: string; placeholderBg: string; iconGlow: string }
> = {
  LOCAL: {
    label: "LOCAL",
    badgeBg: "border-sky-500/55 bg-sky-950/80 text-sky-100/95",
    badgeText: "LOCAL",
    placeholderBg: "bg-gradient-to-br from-sky-600/35 via-slate-900 to-slate-950",
    iconGlow: "text-sky-400/85",
  },
  YT: {
    label: "YT",
    badgeBg: "border-rose-500/50 bg-black/85 text-[#ffe0e8]",
    badgeText: "YT",
    placeholderBg: "bg-gradient-to-br from-rose-900/40 via-slate-950 to-black",
    iconGlow: "text-rose-500/95",
  },
  CAT: {
    label: "CAT",
    badgeBg: "border-violet-500/55 bg-violet-950/80 text-violet-100/95",
    badgeText: "CAT",
    placeholderBg: "bg-gradient-to-br from-violet-600/30 via-slate-900 to-slate-950",
    iconGlow: "text-violet-300/95",
  },
  LIB: {
    label: "LIB",
    badgeBg: "border-emerald-500/50 bg-emerald-950/80 text-emerald-100/95",
    badgeText: "LIB",
    placeholderBg: "bg-gradient-to-br from-emerald-700/28 via-slate-900 to-slate-950",
    iconGlow: "text-emerald-400/95",
  },
  RADIO: {
    label: "RADIO",
    badgeBg: "border-fuchsia-500/50 bg-black/72 text-fuchsia-100/98",
    badgeText: "RADIO",
    placeholderBg: "bg-gradient-to-br from-fuchsia-900/38 via-slate-900 to-black",
    iconGlow: "text-fuchsia-400/98",
  },
};


export function CompactSourceBadge({
  chip,
  className = "",
}: {
  chip: TrackSourceChip;
  className?: string;
}): React.ReactElement {
  const m = CHIP_META[chip];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-[1px] font-mono text-[8px] font-bold uppercase tracking-widest backdrop-blur-sm ${m.badgeBg} ${className}`}
      title={m.label}
    >
      {m.badgeText}
    </span>
  );
}

function PlaceholderIcon({
  chip,
  className = "h-[55%] w-[55%] min-h-4 min-w-4 opacity-92",
}: {
  chip: TrackSourceChip;
  className?: string;
}): React.ReactElement {
  const glow = CHIP_META[chip].iconGlow;
  if (chip === "YT") {
    return (
      <svg className={`${className} ${glow}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  }
  if (chip === "RADIO") {
    return (
      <svg className={`${className} ${glow}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M4 10v6a3 3 0 003 3h10a3 3 0 003-3v-6" strokeLinecap="round" />
        <path d="M6 14h12M10 17h4" strokeLinecap="round" />
        <path d="M8 10V7a5 5 0 019.9-.9" strokeLinecap="round" />
        <circle cx="17" cy="6" r="2" />
      </svg>
    );
  }
  if (chip === "CAT") {
    return (
      <svg className={`${className} ${glow}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <circle cx="11" cy="11" r="6" strokeLinecap="round" />
        <path d="M16 16l5 5" strokeLinecap="round" />
        <path d="M8 14h7M8 10h11" strokeLinecap="round" opacity="0.55" />
      </svg>
    );
  }
  if (chip === "LIB") {
    return (
      <svg className={`${className} ${glow}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  return (
    <svg className={`${className} ${glow}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M5 17h14V7H5v10zM8 5h8M12 21V17" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="12.5" r="1.5" fill="currentColor" />
      <path d="M15 13l-2 2 2 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Album-art slot when no per-track/per-item image is available — never substitutes playlist envelope art.
 */
export function TrackMediaPlaceholder({
  chip,
  className = "",
  showCornerBadge = false,
}: {
  chip: TrackSourceChip;
  className?: string;
  /** Dropdown / dense lists can show the chip overlay; tiles often use the kind strip instead. */
  showCornerBadge?: boolean;
}): React.ReactElement {
  const m = CHIP_META[chip];
  return (
    <div
      role="presentation"
      className={`relative flex h-full w-full items-center justify-center overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${m.placeholderBg} ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.18] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.2),transparent_72%)]" />
      <PlaceholderIcon chip={chip} />
      {showCornerBadge ? (
        <span className="pointer-events-none absolute bottom-0.5 right-0.5">
          <CompactSourceBadge chip={chip} />
        </span>
      ) : null}
    </div>
  );
}
