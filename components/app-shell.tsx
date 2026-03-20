"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { useLocale, useTranslations, type Locale } from "@/lib/locale-context";
import { labels } from "@/lib/locale-context";
import { AudioPlayer } from "@/components/audio-player";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { DeviceModeIndicator } from "@/components/device-mode-indicator";
import { GuestLinkButton } from "@/components/guest-link-button";
import { StandaloneIndicator } from "@/components/standalone-indicator";

const categoryKeys = ["dashboard", "sources", "radio", "owner", "schedules", "logs"] as const;
const categoryItems = categoryKeys.map((key) => ({
  href: key === "dashboard" ? "/dashboard" : key === "owner" ? "/owner" : `/${key}`,
  labelKey: key === "sources" ? "library" : key,
  iconKey: key,
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
function IconOwner() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
function IconPlaylists() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
function IconLibrary() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="16" y2="11" />
    </svg>
  );
}
function IconRadio() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3l4 4" />
      <path d="M19 3l-4 4" />
      <path d="M12 22v-8" />
      <path d="M5 7l4 4" />
      <path d="M19 7l-4 4" />
      <path d="M12 14v4" />
      <circle cx="12" cy="18" r="2" />
      <path d="M5 7a7 7 0 0 1 14 0" strokeOpacity="0.5" />
    </svg>
  );
}
const categoryIcons: Record<(typeof categoryKeys)[number], () => React.ReactElement> = {
  dashboard: IconDashboard,
  sources: IconSources,
  radio: IconRadio,
  owner: IconOwner,
  schedules: IconSchedules,
  logs: IconLogs,
};
const pillBase = "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_8px_rgba(0,0,0,0.25)] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:ring-offset-2 focus:ring-offset-slate-950";
const pillInactive = "border-slate-700/80 bg-slate-900/70 text-slate-400 hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 hover:shadow-[0_0_20px_rgba(100,116,139,0.08)]";
const pillActive = "border-sky-500/40 bg-sky-500/15 text-sky-200 shadow-[0_0_24px_rgba(56,189,248,0.15)]";

const navKeys = [
  "dashboard",
  "sources",
  "radio",
  "favorites",
  "remote",
  "owner",
  "schedules",
  "logs",
  "settings",
  "architecture",
] as const;
const navItems = navKeys.map((key) => ({
  href: key === "dashboard" ? "/dashboard" : key === "remote" ? "/mobile" : key === "owner" ? "/owner" : `/${key}`,
  labelKey: key === "sources" ? "library" : key,
}));

function getTimeBasedGreeting(locale: Locale, t: Record<string, string>): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return t.greetingMorning ?? "Good morning";
  if (h >= 12 && h < 17) return t.greetingAfternoon ?? "Good afternoon";
  if (h >= 17 && h < 20) return t.greetingEvening ?? "Good evening";
  return t.greetingNight ?? "Good night";
}

function LogoutButton() {
  const router = useRouter();
  const { t } = useTranslations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
        className="rounded-lg border border-slate-700/80 bg-slate-900/60 px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:border-slate-600 hover:bg-slate-800/80 hover:text-slate-200 disabled:opacity-50"
      >
        {loading ? "…" : "Logout"}
      </button>
      <DeleteConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleLogout}
        title={t.logoutConfirmTitle}
        message={t.logoutConfirm}
        confirmLabel={t.confirmLogout}
        loading={loading}
        loadingLabel={t.loggingOut}
        compact
      />
    </>
  );
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
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const { t } = useTranslations();
  const [now, setNow] = useState(() => new Date());
  const greeting = getTimeBasedGreeting(locale, t);
  const headerSubtitle = t.headerSubtitle ?? labels.headerSubtitle?.en ?? "Schedule playback and send commands to endpoint devices";

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString(locale === "he" ? "he-IL" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Mobile: minimal layout. AudioPlayer must be in-viewport for mobile browsers to load/play
  // (off-screen -left-[9999px] causes iOS Safari etc. to skip loading iframes/audio)
  // Also use minimal layout for edit pages when return=/mobile (user came from mobile player)
  const isMobileReturn = searchParams.get("return") === "/mobile";
  const isMobileOrEditFromMobile =
    pathname === "/mobile" || (pathname?.includes("/edit") && isMobileReturn);
  if (isMobileOrEditFromMobile) {
    return (
      <>
        <div
          className="fixed bottom-0 right-0 z-0 opacity-0 pointer-events-none"
          aria-hidden
          style={{ width: 320, height: 180 }}
        >
          <AudioPlayer />
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50">
      <aside className="hidden w-56 flex-col border-r border-slate-800/60 bg-slate-950/95 px-4 py-5 lg:flex sticky top-0 self-start h-screen overflow-y-auto">
        <Link href="/library" className="flex items-center gap-2.5 px-1">
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
        <header
          className="sticky top-0 z-50 flex flex-col overflow-hidden border-b border-slate-800/80 bg-slate-950/98 shadow-[0_4px_24px_rgba(0,0,0,0.4)] backdrop-blur-md"
          role="banner"
        >
          {/* Row 1: Title, greeting, time */}
          <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 border-b border-slate-800/60 px-3 py-3 sm:gap-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold tracking-tight text-slate-50">
                {t.businessMediaScheduler ?? "Business Media Scheduler"}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                {headerSubtitle}
              </p>
            </div>
            <div className="flex min-w-0 shrink items-center gap-2">
              <div
                className="flex min-w-0 shrink items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/90 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.3)] sm:gap-2.5 sm:px-3"
                dir={locale === "he" ? "rtl" : "ltr"}
              >
                <span className="shrink-0 text-base font-semibold tabular-nums text-slate-200" suppressHydrationWarning>
                  {timeStr}
                </span>
                <span className="h-4 w-px shrink-0 bg-slate-700/60" aria-hidden />
                <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                  <span className="shrink-0 text-slate-500">{greeting}</span>
                  <span className="h-3 w-px shrink-0 bg-slate-700/50" aria-hidden />
                  <span className="truncate font-medium text-slate-100">
                    {t.subscriberName ?? "Subscriber"}
                  </span>
                  <span className="h-3 w-px shrink-0 bg-slate-700/50" aria-hidden />
                  <span className="truncate text-slate-400">
                    {t.companyName ?? "Company"}
                  </span>
                </div>
              </div>
              <StandaloneIndicator />
              <DeviceModeIndicator />
              <GuestLinkButton />
              <span className="hidden items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-400 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t.agentsHealthy}
              </span>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 bg-slate-900/80 text-xs font-medium text-slate-400">
                SB
              </span>
            </div>
          </div>
          {/* Row 2: Nav pills + language */}
          <div className="flex flex-nowrap items-center justify-between gap-2 border-b border-slate-800/50 px-3 py-1.5 sm:px-4">
            <nav className="flex flex-wrap items-center gap-1.5" aria-label="Main">
              {categoryItems.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);
                const label = labels[item.labelKey]?.[locale] ?? item.labelKey;
                const Icon = categoryIcons[item.iconKey];
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
            <div className="ms-auto flex shrink-0 items-center gap-2">
              <LogoutButton />
              <LanguageToggle />
            </div>
          </div>
          {/* Row 3: Player */}
          <AudioPlayer />
        </header>

        <main className="flex-1 px-4 pb-4 py-5 sm:px-6">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
