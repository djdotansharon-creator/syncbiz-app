"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type Tab = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Tab is active when pathname is exactly href OR starts with `${href}/` (for nested routes). */
  match?: (pathname: string) => boolean;
};

const TABS: Tab[] = [
  {
    href: "/mobile/home",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5">
        <path d="M12 3 3 10v10h6v-6h6v6h6V10z" />
      </svg>
    ),
  },
  {
    href: "/mobile/search",
    label: "Search",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="h-5 w-5">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/mobile/library",
    label: "Library",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5">
        <path d="M4 4h2v16H4zM8 4h2v16H8zM13 4h2v16h-2zM17 4l5 16h-2.2L15 8z" />
      </svg>
    ),
  },
  {
    href: "/mobile/remote",
    label: "Remote",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="h-5 w-5">
        <rect x="6" y="2" width="12" height="20" rx="3" />
        <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
        <path d="M9 6h6M9 9h6" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function MobileBottomNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      className="grid grid-cols-4 border-t border-slate-800/80 bg-slate-950/98 backdrop-blur-sm pb-[env(safe-area-inset-bottom,0px)]"
      aria-label="Mobile navigation"
    >
      {TABS.map((tab) => {
        const isActive = tab.match ? tab.match(pathname) : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors touch-manipulation ${
              isActive ? "text-slate-50" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <span className={isActive ? "opacity-100" : "opacity-80"}>{tab.icon}</span>
            <span className="tracking-wide">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
