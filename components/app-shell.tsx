"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { useLocale, useTranslations, type Locale } from "@/lib/locale-context";
import { labels } from "@/lib/locale-context";
import { useLibraryTheme } from "@/lib/library-theme-context";
import { AudioPlayer } from "@/components/audio-player";
import { usePlayback } from "@/lib/playback-provider";
import { inferPlaylistType } from "@/lib/playlist-utils";
import { createPlaylistFromUrl, resolveYouTubePlayableUrlForSearch } from "@/lib/search-playlist-client";
import { radioToUnified } from "@/lib/radio-utils";
import { fetchUnifiedSourcesWithFallback, savePlaylistToLocal, saveRadioToLocal } from "@/lib/unified-sources-client";
import { unifiedFoundationHints, type UnifiedSource, type ParseUrlJson, type RadioStream } from "@/lib/source-types";
import { searchExternal } from "@/lib/search-service";
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
  "access-control",
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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const { t } = useTranslations();
  const [now, setNow] = useState(() => new Date());
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [sessionAccountName, setSessionAccountName] = useState<string | null>(null);
  const greeting = getTimeBasedGreeting(locale, t);
  const headerSubtitle = t.headerSubtitle ?? labels.headerSubtitle?.en ?? "Schedule playback and send commands to endpoint devices";

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { name?: string | null; email?: string | null; accountName?: string | null } | null) => {
        if (cancelled || !data) return;
        const displayName = (data.name ?? "").trim() || (data.email ?? "").trim() || null;
        setSessionName(displayName);
        setSessionAccountName((data.accountName ?? "").trim() || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const timeStr = now.toLocaleTimeString(locale === "he" ? "he-IL" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const isSourcesLibraryRoute = pathname?.startsWith("/sources") ?? false;
  const isMediaThemeRoute =
    pathname?.startsWith("/sources") ||
    pathname?.startsWith("/radio") ||
    pathname?.startsWith("/favorites") ||
    false;
  const { libraryTheme } = useLibraryTheme();
  const { playSource, setQueue } = usePlayback();
  const [playerDropActive, setPlayerDropActive] = useState(false);

  const parseDroppedUrl = async (url: string): Promise<ParseUrlJson | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch("/api/sources/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const extractUrlFromDrop = (e: React.DragEvent): string | null => {
    const uriList = e.dataTransfer.getData("text/uri-list");
    const plain = e.dataTransfer.getData("text/plain");
    const raw = (uriList || plain || "").trim();
    const first = raw.split(/[\r\n]+/)[0]?.trim();
    if (!first) return null;
    return first.startsWith("http://") || first.startsWith("https://") ? first : null;
  };

  const playDroppedUrl = async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    const parsed = await parseDroppedUrl(trimmed);
    const inferredType = inferPlaylistType(trimmed);
    const typeCandidate = parsed?.type ?? inferredType;
    const apiType = ["youtube", "soundcloud", "spotify", "winamp", "local", "stream-url"].includes(typeCandidate)
      ? typeCandidate
      : inferredType;
    const isRadio = parsed?.isRadio || apiType === "winamp" || /\.(m3u8?|pls|aac|mp3)(\?|$)/i.test(trimmed);

    if (parsed?.type === "shazam") {
      const searchQuery =
        parsed?.artist && parsed?.song
          ? `${parsed.artist} ${parsed.song}`
          : parsed?.title ?? "";
      const { youtube } = await searchExternal(searchQuery);
      const first = youtube.find((r) => r.type === "youtube") ?? youtube[0];
      if (!first) return;
      const resolvedFirstUrl =
        first.type === "youtube"
          ? await resolveYouTubePlayableUrlForSearch(first.url)
          : first.url;
      const created = await createPlaylistFromUrl(resolvedFirstUrl, {
        title: parsed?.title || first.title || "Untitled",
        genre: parsed?.genre || "Mixed",
        cover: first.cover || parsed?.cover || null,
        type: "youtube",
        viewCount: first.viewCount,
        durationSeconds: first.durationSeconds,
      });
      if (!created) return;
      const unified: UnifiedSource = {
        id: `pl-${created.id}`,
        title: created.name,
        genre: created.genre || "Mixed",
        cover: created.thumbnail || null,
        type: created.type as UnifiedSource["type"],
        url: created.url,
        origin: "playlist",
        playlist: created,
        ...unifiedFoundationHints("playlist", created.type as UnifiedSource["type"], created.url),
      };
      savePlaylistToLocal(created);
      setQueue([unified]);
      playSource(unified);
      return;
    }

    if (isRadio) {
      const res = await fetch("/api/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: parsed?.title || "Radio Station",
          url: trimmed,
          genre: parsed?.genre || "Live Radio",
          cover: parsed?.cover || null,
        }),
      });
      if (!res.ok) return;
      const station = (await res.json()) as RadioStream;
      const unified = radioToUnified(station);
      saveRadioToLocal(station);
      setQueue([unified]);
      playSource(unified);
      return;
    }

    const playableUrl = apiType === "youtube" ? await resolveYouTubePlayableUrlForSearch(trimmed) : trimmed;
    const created = await createPlaylistFromUrl(playableUrl, {
      title: parsed?.title || "Untitled",
      genre: parsed?.genre || "Mixed",
      cover: parsed?.cover || null,
      type: apiType,
      viewCount: parsed?.viewCount,
      durationSeconds: parsed?.durationSeconds,
    });
    if (!created) return;
    const unified: UnifiedSource = {
      id: `pl-${created.id}`,
      title: created.name,
      genre: created.genre || "Mixed",
      cover: created.thumbnail || null,
      type: created.type as UnifiedSource["type"],
      url: created.url,
      origin: "playlist",
      playlist: created,
      ...unifiedFoundationHints("playlist", created.type as UnifiedSource["type"], created.url),
    };
    savePlaylistToLocal(created);
    setQueue([unified]);
    playSource(unified);
  };

  const handlePlayerDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPlayerDropActive(false);

    const queueSourcesJson = e.dataTransfer.getData("application/syncbiz-queue-sources");
    if (queueSourcesJson) {
      try {
        const queue = JSON.parse(queueSourcesJson) as UnifiedSource[];
        if (Array.isArray(queue) && queue.length > 0) {
          setQueue(queue);
          playSource(queue[0]);
          return;
        }
      } catch {
        // Ignore malformed payload.
      }
    }

    const queueJson = e.dataTransfer.getData("application/syncbiz-queue-source-ids");
    if (queueJson) {
      try {
        const ids = JSON.parse(queueJson) as string[];
        const allSources = await fetchUnifiedSourcesWithFallback();
        const byId = new Map(allSources.map((s) => [s.id, s] as const));
        const queue = ids.map((id) => byId.get(id)).filter((s): s is UnifiedSource => !!s);
        if (queue.length > 0) {
          setQueue(queue);
          playSource(queue[0]);
          return;
        }
      } catch {
        // Ignore malformed payload.
      }
    }

    const sourceJson = e.dataTransfer.getData("application/syncbiz-source-json");
    if (sourceJson) {
      try {
        const source = JSON.parse(sourceJson) as UnifiedSource;
        if (source?.id && source?.url) {
          setQueue([source]);
          playSource(source);
          return;
        }
      } catch {
        // Ignore malformed payload.
      }
    }

    const sourceId = e.dataTransfer.getData("application/syncbiz-source-id");
    if (sourceId) {
      const allSources = await fetchUnifiedSourcesWithFallback();
      const source = allSources.find((s) => s.id === sourceId);
      if (source) {
        setQueue([source]);
        playSource(source);
        return;
      }
    }

    const url = extractUrlFromDrop(e);
    if (url) await playDroppedUrl(url);
  };

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
      <aside
        className={`hidden w-56 flex-col border-r border-slate-800/60 bg-slate-950/95 px-4 py-5 lg:flex sticky top-0 self-start h-screen overflow-y-auto${
          isMediaThemeRoute ? " media-theme-sidebar" : ""
        }`}
        {...(isMediaThemeRoute ? { "data-library-theme": libraryTheme } : {})}
      >
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
                  isMediaThemeRoute
                    ? isActive
                      ? "media-sidebar-link media-sidebar-link-active"
                      : "media-sidebar-link media-sidebar-link-idle"
                    : isActive
                      ? "bg-slate-800/80 text-sky-100"
                      : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isMediaThemeRoute
                      ? isActive
                        ? "media-sidebar-dot-active"
                        : "media-sidebar-dot-idle"
                      : isActive
                        ? "bg-sky-400"
                        : "bg-slate-600"
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

      <div
        className={`flex min-h-screen flex-1 flex-col${isMediaThemeRoute ? " app-sources-theme-scope" : ""}`}
        {...(isMediaThemeRoute ? { "data-library-theme": libraryTheme } : {})}
      >
        <header
          className={`sticky top-0 z-50 flex flex-col overflow-hidden border-b border-slate-800/80 bg-slate-950/98 shadow-[0_4px_24px_rgba(0,0,0,0.4)] backdrop-blur-md${
            isMediaThemeRoute ? " sources-app-header" : ""
          }`}
          role="banner"
        >
          {/* Row 1: Title, greeting, time */}
          <div
            className={`flex min-w-0 flex-nowrap items-center justify-between gap-2 border-b border-slate-800/60 px-3 py-3 sm:gap-3 sm:px-6${
              isMediaThemeRoute ? " sources-app-header-row1" : ""
            }`}
          >
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
                className={`flex min-w-0 shrink items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/90 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.3)] sm:gap-2.5 sm:px-3${
                  isSourcesLibraryRoute ? " sources-header-meta-plate" : ""
                }`}
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
                    {sessionName ?? t.subscriberName ?? "Subscriber"}
                  </span>
                  <span className="h-3 w-px shrink-0 bg-slate-700/50" aria-hidden />
                  <span className="truncate text-slate-300">
                    {sessionAccountName ?? t.companyName ?? "Company"}
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
          <div
            className={`flex flex-nowrap items-center justify-between gap-2 border-b border-slate-800/50 px-3 py-1.5 sm:px-4${
              isMediaThemeRoute ? " sources-app-header-row2" : ""
            }`}
          >
            <nav className="flex flex-wrap items-center gap-1.5" aria-label="Main">
              {categoryItems.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);
                const label = labels[item.labelKey]?.[locale] ?? item.labelKey;
                const Icon = categoryIcons[item.iconKey];
                const pillClass = isMediaThemeRoute
                  ? `inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_8px_rgba(0,0,0,0.25)] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-slate-400/40 focus:ring-offset-0 source-nav-pill ${
                      isActive ? "source-nav-pill-active" : "source-nav-pill-idle"
                    }`
                  : `${pillBase} ${isActive ? pillActive : pillInactive}`;
                const focusRing = isMediaThemeRoute ? "" : " focus:ring-offset-2 focus:ring-offset-slate-950";
                return (
                  <Link key={item.href} href={item.href} className={`${pillClass}${focusRing}`}>
                    {Icon && <Icon />}
                    {label}
                  </Link>
                );
              })}
            </nav>
            <div className="sources-system-cluster ms-auto flex shrink-0 items-center gap-2">
              <LogoutButton />
            </div>
          </div>
          {/* Row 3: Player */}
          {isMediaThemeRoute ? (
            <div className="library-theme library-player-route-bridge" data-library-theme={libraryTheme}>
              <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_260px] 2xl:grid-cols-[minmax(0,1fr)_280px]">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setPlayerDropActive(true);
                  }}
                  onDragLeave={() => setPlayerDropActive(false)}
                  onDrop={(e) => void handlePlayerDrop(e)}
                  className={`relative min-w-0 overflow-hidden rounded-2xl border bg-slate-950/72 p-1.5 shadow-[0_0_0_1px_rgba(56,189,248,0.06),0_12px_30px_rgba(0,0,0,0.42)] backdrop-blur-md transition-colors ${
                    playerDropActive ? "border-cyan-400/70" : "border-slate-700/70"
                  }`}
                >
                  {playerDropActive ? (
                    <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-cyan-300/45 bg-cyan-500/14 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                      Drop To Play
                    </div>
                  ) : null}
                  <AudioPlayer />
                </div>
                <aside className="hidden xl:block">
                  <div className="h-full rounded-2xl border border-cyan-500/25 bg-slate-950/80 p-3 shadow-[0_0_0_1px_rgba(6,182,212,0.08),0_10px_24px_rgba(0,0,0,0.45)] backdrop-blur-md">
                    <header className="pb-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/90">
                          Command Pads
                        </p>
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200/90">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                          Standby
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-300/80">Live operator trigger area</p>
                    </header>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { title: "Jingles", tone: "border-sky-400/30 bg-sky-500/10 text-sky-100", dot: "bg-sky-300" },
                        { title: "Birthdays", tone: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100", dot: "bg-fuchsia-300" },
                        { title: "Broadcasts", tone: "border-amber-400/30 bg-amber-500/10 text-amber-100", dot: "bg-amber-300" },
                        { title: "Announcements", tone: "border-rose-400/30 bg-rose-500/10 text-rose-100", dot: "bg-rose-300" },
                      ].map((group) => (
                        <button
                          key={group.title}
                          type="button"
                          className={`rounded-xl border px-2.5 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition ${group.tone}`}
                          disabled
                          aria-disabled
                        >
                          <p className="text-xs font-semibold tracking-tight">{group.title}</p>
                          <p className="mt-1 flex items-center gap-1 text-[10px] opacity-90">
                            <span className={`h-1.5 w-1.5 rounded-full ${group.dot}`} />
                            Soon
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          ) : (
            <AudioPlayer />
          )}
        </header>

        <main
          className={`flex-1 px-4 pb-4 sm:px-6${isSourcesLibraryRoute ? " pt-2" : " py-5"}${isMediaThemeRoute ? " library-main-below-deck" : ""}`}
          {...(isMediaThemeRoute ? { "data-library-theme": libraryTheme } : {})}
        >
          <div
            className={
              isSourcesLibraryRoute ? "mx-auto w-full max-w-none" : "mx-auto max-w-5xl"
            }
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
