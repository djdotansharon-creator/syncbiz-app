"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  /** Optional right-aligned action (usually a "See all" link). */
  actionHref?: string;
  actionLabel?: string;
  /** Free-form slot if you need something other than a link. */
  action?: ReactNode;
  className?: string;
};

/**
 * Shared section header for mobile content areas.
 *
 * Hierarchy target: slightly smaller + tighter than the page header from
 * `MobilePageHeader`, but still clearly a level-2 heading. Matches the
 * density of Spotify's "Made for you" / "Jump back in" section titles without
 * copying their iconography.
 */
export function MobileSectionHeader({
  title,
  subtitle,
  actionHref,
  actionLabel = "See all",
  action,
  className = "",
}: Props) {
  return (
    <div className={`mb-3 flex items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold tracking-tight text-slate-100">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 truncate text-xs text-slate-400">{subtitle}</p>
        )}
      </div>
      {action ? (
        <div className="shrink-0">{action}</div>
      ) : actionHref ? (
        <Link
          href={actionHref}
          className="shrink-0 text-xs font-medium text-slate-400 hover:text-slate-200"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
