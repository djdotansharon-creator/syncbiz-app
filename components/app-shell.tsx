"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useLocale, useTranslations, type Locale } from "@/lib/locale-context";
import { labels } from "@/lib/locale-context";

const categoryKeys = ["dashboard", "sources", "schedules", "devices", "logs"] as const;
const categoryItems = categoryKeys.map((key) => ({
  href: key === "dashboard" ? "/dashboard" : `/${key}`,
  labelKey: key,
}));
const pillLink =
  "rounded-xl border border-slate-700/80 bg-slate-900/90 px-3.5 py-2 text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.3)] transition-all duration-100 hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400/30 focus:ring-offset-2 focus:ring-offset-slate-950";

function IconDashboard() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}
function IconSources() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
function IconSchedules() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function IconDevices() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <line x1="6" y1="12" x2="6.01" y2="12" />
      <line x1="10" y1="12" x2="10.01" y2="12" />
      <line x1="14" y1="12" x2="14.01" y2="12" />
      <line x1="18" y1="12" x2="18.01" y2="12" />
    </svg>
  );
}
function IconLogs() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
const categoryIcons: Record<(typeof categoryKeys)[number], () => JSX.Element> = {
  dashboard: IconDashboard,
  sources: IconSources,
  schedules: IconSchedules,
  devices: IconDevices,
  logs: IconLogs,
};
const pillBase = "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_8px_rgba(0,0,0,0.25)] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:ring-offset-2 focus:ring-offset-slate-950";
const pillInactive = "border-slate-700/80 bg-slate-900/70 text-slate-400 hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 hover:shadow-[0_0_20px_rgba(100,116,139,0.08)]";
const pillActive = "border-sky-500/40 bg-sky-500/15 text-sky-200 shadow-[0_0_24px_rgba(56,189,248,0.15)]";

const navKeys = [
  "dashboard",
  "devices",
  "sources",
  "schedules",
  "announcements",
  "logs",
  "settings",
  "architecture",
] as const;

const navItems = navKeys.map((key) => ({
  href: key === "dashboard" ? "/dashboard" : `/${key}`,
  labelKey: key,
}));

function getCurrentSectionLabel(pathname: string, locale: Locale): string {
  for (let i = 0; i < navItems.length; i++) {
    const item = navItems[i];
    if (
      item.href === pathname ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href))
    ) {
      return labels[item.labelKey]?.[locale] ?? item.labelKey;
    }
  }
  return labels.dashboard?.[locale] ?? "Dashboard";
}

function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <div
      className="flex rounded-lg border border-slate-700/80 bg-slate-900/60 p-0.5"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
          locale === "en"
            ? "bg-slate-700 text-slate-100"
            : "text-slate-400 hover:text-slate-200"
        }`}
        aria-pressed={locale === "en"}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale("he")}
        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
          locale === "he"
            ? "bg-slate-700 text-slate-100"
            : "text-slate-400 hover:text-slate-200"
        }`}
        aria-pressed={locale === "he"}
      >
        HE
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { locale } = useLocale();
  const { t } = useTranslations();
  const sectionLabel = getCurrentSectionLabel(pathname, locale);
  const headerSubtitle = t.headerSubtitle ?? labels.headerSubtitle?.en ?? "Schedule playback and send commands to endpoint devices";

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50">
      <aside className="hidden w-56 flex-col border-r border-slate-800/60 bg-slate-950/95 px-4 py-5 lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-1">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-base font-semibold text-sky-400 ring-1 ring-sky-500/30">
            SB
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-50">
              SyncBiz
            </p>
            <p className="text-[11px] text-slate-500">Audio scheduling</p>
          </div>
        </Link>
        <nav className="mt-8 flex-1 space-y-0.5 text-sm">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            const label = labels[item.labelKey]?.[locale] ?? item.labelKey;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 transition ${
                  isActive
                    ? "bg-slate-800/80 text-sky-100"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isActive ? "bg-sky-400" : "bg-slate-600"
                  }`}
                />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 border-t border-slate-800/60 pt-4 text-[11px] text-slate-500">
          {t.sidebarFooter}
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="border-b border-slate-800/60 bg-slate-950/80 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {sectionLabel}
              </p>
              <p className="text-sm text-slate-400">
                {headerSubtitle}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <span className="hidden items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-400 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t.agentsHealthy}
              </span>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 bg-slate-900/80 text-xs font-medium text-slate-400">
                SB
              </span>
            </div>
          </div>
          {/* Top category pills – media control surface style */}
          <nav className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start" aria-label="Main">
            {categoryItems.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
              const label = labels[item.labelKey]?.[locale] ?? item.labelKey;
              const Icon = categoryIcons[item.labelKey];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${pillBase} ${isActive ? pillActive : pillInactive}`}
                >
                  {Icon && <Icon />}
                  {label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 px-4 pb-28 py-5 sm:px-6">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
