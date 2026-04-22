"use client";

import Link from "next/link";
import { useMobileRole } from "@/lib/mobile-role-context";
import type { ReactNode } from "react";

type Props = {
  title: string;
  /** Optional right-side actions (e.g. search icon, add icon). */
  actions?: ReactNode;
  /** Show a small mode pill next to the title (Controller / Player). */
  showModePill?: boolean;
};

export function MobilePageHeader({ title, actions, showModePill = false }: Props) {
  const { mobileRole } = useMobileRole();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/95 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <Link
          href="/mobile/home"
          aria-label="SyncBiz home"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/25 to-cyan-500/20 text-sm font-bold text-sky-300 ring-1 ring-sky-500/40"
        >
          SB
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-lg font-semibold tracking-tight text-slate-100">{title}</h1>
          {showModePill && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${
                mobileRole === "controller"
                  ? "bg-sky-500/15 text-sky-200 ring-sky-500/40"
                  : "bg-amber-500/15 text-amber-200 ring-amber-500/40"
              }`}
            >
              {mobileRole === "controller" ? "Controller" : "Player"}
            </span>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
