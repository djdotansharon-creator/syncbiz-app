"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Premium category tile used on the mobile Library landing page.
 *
 * Same visual spirit as the Home browse tiles (gradient card, top-left
 * title block, decorative icon anchored bottom-right, soft top-right glow)
 * but tuned specifically for Library's category-first layout:
 *   - larger vertical footprint so a category reads as a real "section
 *     entrance", not a secondary action
 *   - optional count chip so the user sees the library's density at a
 *     glance (e.g. "12" next to Ready Playlists)
 *   - optional `statusNote` slot so action tiles (My link / Guest link)
 *     can flash "Copied!" feedback without a separate component
 *   - supports `href` (navigate) OR `onClick` (action) — a single
 *     component covers both tile kinds the page needs
 *
 * Do NOT copy Spotify 1:1 — the gradient tokens and typography here are
 * SyncBiz-native so the tile matches our color hierarchy.
 */
type Props = {
  label: string;
  subtitle?: string;
  href?: string;
  onClick?: () => void;
  /** Tailwind gradient tokens, e.g. "from-sky-500 to-cyan-700". */
  gradient: string;
  icon?: ReactNode;
  /** Optional numeric badge (e.g. playlist count). */
  count?: number;
  /** Full-width hero variant — taller card, larger type. */
  variant?: "hero" | "default";
  /** Ephemeral right-aligned note (e.g. "Copied!"). */
  statusNote?: string | null;
  /** Disable interaction (e.g. when Guest link has no session). */
  disabled?: boolean;
  ariaLabel?: string;
};

export function MobileLibraryCategoryTile({
  label,
  subtitle,
  href,
  onClick,
  gradient,
  icon,
  count,
  variant = "default",
  statusNote = null,
  disabled = false,
  ariaLabel,
}: Props) {
  const isHero = variant === "hero";

  const base = [
    "group relative flex flex-col justify-between overflow-hidden rounded-2xl text-white",
    "bg-gradient-to-br",
    gradient,
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_20px_-6px_rgba(0,0,0,0.5)]",
    "transition",
    disabled ? "opacity-60 pointer-events-none" : "active:scale-[0.985]",
    isHero ? "h-36 px-4 py-3.5" : "h-32 px-3.5 py-3",
  ].join(" ");

  const content = (
    <>
      <div className="relative z-10 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`truncate font-semibold leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] ${
              isHero ? "text-lg" : "text-[15px]"
            }`}
          >
            {label}
          </p>
          {subtitle && (
            <p
              className={`mt-0.5 line-clamp-2 font-medium leading-snug text-white/80 ${
                isHero ? "text-[12px]" : "text-[11px]"
              }`}
            >
              {subtitle}
            </p>
          )}
        </div>
        {typeof count === "number" && (
          <span className="shrink-0 rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-sm">
            {count}
          </span>
        )}
      </div>

      {statusNote && (
        <span className="relative z-10 mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white ring-1 ring-white/25 backdrop-blur-sm">
          {statusNote}
        </span>
      )}

      {icon && (
        <span className="pointer-events-none absolute bottom-1 right-1 rotate-[20deg] text-white/90 drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)] transition-transform group-active:rotate-[14deg]">
          {icon}
        </span>
      )}

      {/* Soft glow in the top-right corner for a non-flat, premium feel. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl"
      />
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        className={`${base} text-left`}
      >
        {content}
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel ?? label} className={base}>
        {content}
      </Link>
    );
  }

  return (
    <div aria-label={ariaLabel ?? label} className={base}>
      {content}
    </div>
  );
}
