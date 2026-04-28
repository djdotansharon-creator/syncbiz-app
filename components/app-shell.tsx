"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useLocale, useTranslations, type Locale } from "@/lib/locale-context";
import { labels } from "@/lib/locale-context";
import { useLibraryTheme } from "@/lib/library-theme-context";
import { AudioPlayer } from "@/components/audio-player";
import { LiveQueuePanel } from "@/components/live-queue-panel";
import { usePlayback } from "@/lib/playback-provider";
import { inferPlaylistType } from "@/lib/playlist-utils";
import { createPlaylistFromUrl, resolveYouTubePlayableUrlForSearch } from "@/lib/search-playlist-client";
import { radioToUnified } from "@/lib/radio-utils";
import { fetchUnifiedSourcesWithFallback, savePlaylistToLocal, saveRadioToLocal } from "@/lib/unified-sources-client";
import { resolveDaypartCollectionSources } from "@/lib/daypart-collection";
import {
  playlistLeafTrackIndexForQueueItem,
  resolveSyncbizPlaylistPlayQueue,
  SYNC_PLAYLIST_ASSIGNMENTS_STORAGE_KEY,
} from "@/lib/syncbiz-playlist-queue";
import { unifiedFoundationHints, type UnifiedSource, type ParseUrlJson, type RadioStream } from "@/lib/source-types";
import { searchExternal } from "@/lib/search-service";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { HeaderDeviceIndicators } from "@/components/header-device-indicators";
import { DesktopDownloadButton } from "@/components/desktop-download-button";
import { CenterModuleContext, type CenterModule, isJinglesModule } from "@/lib/center-module-context";
import { MainMenuPopover, type MainMenuItem } from "@/components/main-menu-popover";
import { useTopNavPins } from "@/lib/use-top-nav-pins";

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
function IconFavorites() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
function IconRemote() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function IconAccess() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function IconArchitecture() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 17.5a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0z" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
/**
 * Icons for every main-menu entry. Library/Radio are intentionally never shown
 * in the floating menu (they are permanent top-bar pins), but we still include
 * them here so other consumers (e.g. future "customize" UI) can reuse the map.
 */
const mainMenuIconMap: Record<string, () => React.ReactElement> = {
  dashboard: IconDashboard,
  sources: IconSources,
  radio: IconRadio,
  favorites: IconFavorites,
  remote: IconRemote,
  owner: IconOwner,
  schedules: IconSchedules,
  logs: IconLogs,
  settings: IconSettings,
  "access-control": IconAccess,
  architecture: IconArchitecture,
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

function getTimeBasedGreeting(hour: number, t: Record<string, string>): string {
  const h = hour;
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
        className="logout-led-button inline-flex items-center gap-1.5 rounded-full border border-sky-400/70 bg-sky-500/12 px-2.5 py-1 text-[11px] font-medium text-sky-100 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.18),0_0_14px_rgba(56,189,248,0.3)] transition hover:border-sky-300/90 hover:bg-sky-500/20 hover:shadow-[inset_0_0_0_1px_rgba(56,189,248,0.3),0_0_22px_rgba(56,189,248,0.48)] focus:outline-none focus:ring-2 focus:ring-sky-400/40 disabled:opacity-50"
      >
        <span aria-hidden className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-300 shadow-[0_0_6px_rgba(56,189,248,0.95)]" />
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
  // Read ?return= from window.location.search instead of useSearchParams() to avoid
  // the Suspense boundary that Next.js injects around useSearchParams() in layout-level
  // Client Components. That boundary briefly shows an empty fallback on navigation,
  // which unmounts AudioPlayer and destroys the YouTube iframe, stopping playback.
  const [isMobileReturn, setIsMobileReturn] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsMobileReturn(new URLSearchParams(window.location.search).get("return") === "/mobile");
  }, [pathname]);
  const { locale } = useLocale();
  const { t } = useTranslations();
  const [now, setNow] = useState(() => new Date());
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [sessionAccountName, setSessionAccountName] = useState<string | null>(null);
  const greeting = getTimeBasedGreeting(now.getHours(), t);
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
  // Unified deck treatment: every desktop (app) route gets the media-theme
  // player shell — hero card + Command Pads aside + library-theme tokens —
  // so the top bar looks identical on /library, /radio, /owner, /schedules,
  // /logs, /remote, etc. The mobile layout short-circuits above (see
  // `isMobileOrEditFromMobile` branch), so this flag is only read on
  // desktop routes.
  const isMediaThemeRoute = true;
  const { libraryTheme } = useLibraryTheme();
  const { playSource, setQueue } = usePlayback();
  const [playerDropActive, setPlayerDropActive] = useState(false);
  const [activeCenterModule, setActiveCenterModule] = useState<CenterModule>(null);
  const [mainMenuOpen, setMainMenuOpen] = useState(false);
  const mainMenuTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const { isPinned: isCategoryPinned, togglePin: toggleCategoryPin } = useTopNavPins();
  // The floating main menu exposes every nav entry *except* Library and Radio
  // (permanent pins to the top bar) and Favorites (surfaced via library
  // filters, per user request). Each remaining item carries a Pin toggle so
  // the user can promote it to the top bar at any time.
  const mainMenuItems: MainMenuItem[] = navItems
    .filter(
      (item) =>
        item.labelKey !== "library" &&
        item.labelKey !== "radio" &&
        item.labelKey !== "favorites",
    )
    .map((item) => {
      const Icon = mainMenuIconMap[item.labelKey] ?? mainMenuIconMap.dashboard;
      const isActive =
        item.href === "/dashboard"
          ? pathname === "/dashboard"
          : pathname.startsWith(item.href);
      return {
        key: item.href,
        href: item.href,
        label: labels[item.labelKey]?.[locale] ?? item.labelKey,
        icon: <Icon />,
        isActive,
        isPinned: isCategoryPinned(item.labelKey),
        onTogglePin: () => toggleCategoryPin(item.labelKey),
      };
    });

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
      setQueue([unified], { force: true });
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
      setQueue([unified], { force: true });
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
    console.log("[SyncBiz Audit] playlist load resolved", {
      sourceId: unified.id,
      origin: unified.origin,
      playlistId: created.id,
      queueLen: 1,
      isShazam: parsed?.type === "shazam",
    });
    setQueue([unified], { force: true });
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
          setQueue(queue, { force: true });
          playSource(queue[0], playlistLeafTrackIndexForQueueItem(queue[0]));
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
          setQueue(queue, { force: true });
          playSource(queue[0], playlistLeafTrackIndexForQueueItem(queue[0]));
          return;
        }
      } catch {
        // Ignore malformed payload.
      }
    }

    const playlistContainerJson = e.dataTransfer.getData("application/syncbiz-playlist-container");
    if (playlistContainerJson) {
      try {
        const payload = JSON.parse(playlistContainerJson) as { subtype?: string; key?: string };
        if (payload.subtype === "syncbiz_playlist" && payload.key) {
          let assignments: Record<string, string[]> = {};
          try {
            const raw = typeof window !== "undefined" ? localStorage.getItem(SYNC_PLAYLIST_ASSIGNMENTS_STORAGE_KEY) : null;
            assignments = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
          } catch {
            assignments = {};
          }
          const allSources = await fetchUnifiedSourcesWithFallback();
          const queue = resolveSyncbizPlaylistPlayQueue(payload.key, allSources, assignments);
          if (queue.length > 0) {
            setQueue(queue, { force: true });
            playSource(queue[0], playlistLeafTrackIndexForQueueItem(queue[0]));
            return;
          }
        }
        if (payload.subtype === "daypart_collection" && payload.key) {
          const allSources = await fetchUnifiedSourcesWithFallback();
          const queue = resolveDaypartCollectionSources(payload.key, allSources);
          if (queue.length > 0) {
            setQueue(queue, { force: true });
            playSource(queue[0], playlistLeafTrackIndexForQueueItem(queue[0]));
            return;
          }
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
          setQueue([source], { force: true });
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
        setQueue([source], { force: true });
        playSource(source);
        return;
      }
    }

    const url = extractUrlFromDrop(e);
    if (url) await playDroppedUrl(url);
  };

  // Mobile: minimal layout. AudioPlayer must be in-viewport for mobile browsers to load/play
  // (off-screen -left-[9999px] causes iOS Safari etc. to skip loading iframes/audio)
  // Also use minimal layout for edit pages when return=/mobile (user came from mobile player).
  //
  // The check uses a prefix match so every mobile tab route (/mobile/home, /mobile/search, …)
  // gets the same minimal chrome. The mobile layout at `app/(app)/mobile/layout.tsx` provides
  // its own header, mini player, and bottom nav.
  const isMobilePath = pathname === "/mobile" || pathname?.startsWith("/mobile/");
  const isMobileOrEditFromMobile =
    isMobilePath || (pathname?.includes("/edit") && isMobileReturn);
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
    <CenterModuleContext.Provider value={{ active: activeCenterModule, setActive: setActiveCenterModule }}>
    <div className="flex min-h-screen bg-slate-950 text-slate-50">
      {/*
       * Desktop sidebar intentionally removed. All its navigation entries now
       * live in the top bar (Library + Radio pinned) and in the floating
       * "Main menu" gear popover (everything else). Mobile gets its own layout
       * earlier in the component (isMobileOrEditFromMobile branch) so this
       * change does not affect the mobile experience.
       */}

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
          {/* Row 1: Left (logo + title) · Center (time/user/station chip) · Right (indicators + gear) */}
          <div
            className={`flex min-w-0 flex-nowrap items-center gap-2 border-b border-slate-800/60 px-3 py-3 sm:gap-3 sm:px-6${
              isMediaThemeRoute ? " sources-app-header-row1" : ""
            }`}
          >
            <div className="flex min-w-0 flex-1 basis-0 items-center gap-3">
              <Link href="/library" className="flex shrink-0 items-center gap-2.5" aria-label="SyncBiz">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-base font-semibold text-sky-400 ring-1 ring-sky-500/30">
                  SB
                </span>
                <div className="hidden min-w-0 sm:block">
                  <p className="text-sm font-semibold leading-tight tracking-tight text-slate-50">
                    SyncBiz
                  </p>
                  <p className="text-[11px] leading-tight text-slate-500">Audio scheduling</p>
                </div>
              </Link>
              <span className="hidden h-8 w-px shrink-0 bg-slate-800/80 sm:block" aria-hidden />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-bold tracking-tight text-slate-50">
                  {t.businessMediaScheduler ?? "Business Media Scheduler"}
                </h1>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {headerSubtitle}
                </p>
              </div>
            </div>
            {/* Centered meta chip — gentle cyan frame + soft outer glow so it
                reads as "alive" without stealing attention from the Master LED. */}
            <div
              className={`flex min-w-0 shrink items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-slate-900/85 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_0_0_1px_rgba(56,189,248,0.12),0_0_22px_rgba(56,189,248,0.14),0_2px_6px_rgba(0,0,0,0.3)] sm:gap-2.5 sm:px-3${
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
            <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-1.5 sm:gap-2">
              <div className="me-0.5 min-w-0 shrink-0 border-e border-slate-600/60 pe-2 sm:pe-3">
                <DesktopDownloadButton />
              </div>
              <HeaderDeviceIndicators />
              <span className="hidden items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-400 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t.agentsHealthy}
              </span>
              <div className="relative">
                <button
                  ref={mainMenuTriggerRef}
                  type="button"
                  aria-label={t.mainMenu ?? "Main menu"}
                  title={t.mainMenu ?? "Main menu"}
                  aria-haspopup="menu"
                  aria-expanded={mainMenuOpen}
                  onClick={() => setMainMenuOpen((v) => !v)}
                  className={`main-menu-gear inline-flex h-8 w-8 items-center justify-center rounded-full border text-slate-300 transition ${
                    mainMenuOpen
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.25)]"
                      : "border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-800 hover:text-slate-100"
                  }`}
                >
                  <IconGear />
                </button>
                <MainMenuPopover
                  open={mainMenuOpen}
                  onClose={() => setMainMenuOpen(false)}
                  anchorRef={mainMenuTriggerRef}
                  items={mainMenuItems}
                  title={t.mainMenu ?? "Main menu"}
                  pinLabel={t.pinToTop ?? "Pin to top"}
                  dir={locale === "he" ? "rtl" : "ltr"}
                />
              </div>
            </div>
          </div>
          {/* Row 2: Nav pills + language */}
          <div
            className={`flex flex-nowrap items-center justify-between gap-2 border-b border-slate-800/50 px-3 py-1.5 sm:px-4${
              isMediaThemeRoute ? " sources-app-header-row2" : ""
            }`}
          >
            <nav className="flex flex-wrap items-center gap-1.5" aria-label="Main">
              {/* Pill order is the canonical navKeys order so the pins stay in
                  a stable, predictable sequence regardless of the order the
                  user toggled them on. Library + Radio are always first (and
                  non-removable); every other pill appears only if pinned. */}
              {navItems
                .filter((item) => isCategoryPinned(item.labelKey))
                .map((item) => {
                  const isActive =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname.startsWith(item.href);
                  const label = labels[item.labelKey]?.[locale] ?? item.labelKey;
                  const Icon = mainMenuIconMap[item.labelKey];
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
          {/* Row 3: Player — keep a single AudioPlayer instance across routes (media vs non-media); swapping branches remounts embeds */}
          <div
            className={isMediaThemeRoute ? "library-theme library-player-route-bridge shrink-0 overflow-x-hidden px-3 pb-2 sm:px-4" : undefined}
            {...(isMediaThemeRoute ? { "data-library-theme": libraryTheme } : {})}
          >
            {/*
             * Deck row: unified [Live Queue | Player | Command Pads] card, height-capped at xl+ so
             * the player band stays predictable. LiveQueuePanel owns its own internal scroll.
             */}
            <div
              className={
                isMediaThemeRoute
                  ? "library-deck-unified overflow-hidden rounded-2xl border border-slate-700/55 bg-slate-950/70 shadow-[0_12px_30px_rgba(0,0,0,0.42)] backdrop-blur-md"
                  : undefined
              }
            >
            <div
              className={
                isMediaThemeRoute
                  ? // Live Queue widened from 260/280 -> 300/320 to give the new Time column +
                    // always-on trash icons enough breathing room without truncating titles.
                    // Command Pads (right) keep their original width to avoid disturbing the
                    // existing pad grid; only the left aside grew, balanced against the
                    // flexible 1fr middle column.
                    "grid min-w-0 xl:grid-cols-[300px_minmax(0,1fr)_260px] xl:h-[220px] 2xl:grid-cols-[320px_minmax(0,1fr)_280px] 2xl:h-[240px]"
                  : "grid grid-cols-1"
              }
            >
              {isMediaThemeRoute ? (
                <aside className="library-deck-slot-aside relative z-[60] isolate hidden h-full min-h-0 overflow-hidden xl:block xl:border-e xl:border-slate-800/60">
                  <div className="flex h-full min-h-0 flex-col overflow-hidden p-2.5">
                    <LiveQueuePanel />
                  </div>
                </aside>
              ) : null}
              <div
                {...(isMediaThemeRoute
                  ? {
                      onDragOver: (e: React.DragEvent) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                        setPlayerDropActive(true);
                      },
                      onDragLeave: () => setPlayerDropActive(false),
                      onDrop: (e: React.DragEvent) => void handlePlayerDrop(e),
                    }
                  : {})}
                className={
                  isMediaThemeRoute
                    ? `library-deck-player-cell relative h-full min-h-0 min-w-0 overflow-hidden transition-colors ${
                        playerDropActive ? "ring-2 ring-inset ring-cyan-400/70" : ""
                      }`
                    : "relative min-w-0 w-full"
                }
              >
                {isMediaThemeRoute && playerDropActive ? (
                  <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-cyan-300/45 bg-cyan-500/14 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                    Drop To Play
                  </div>
                ) : null}
                <AudioPlayer />
              </div>
              {isMediaThemeRoute ? (
                <aside className="library-deck-pads-aside relative z-[60] isolate hidden h-full overflow-hidden xl:block xl:border-s xl:border-slate-800/60">
                  <div className="flex h-full flex-col overflow-hidden p-3">
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
                        { key: "jingles" as const, title: "Jingles", tone: "border-sky-400/30 bg-sky-500/10 text-sky-100", activeTone: "border-sky-400/70 bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40", dot: "bg-sky-300" },
                        { key: null, title: "Birthdays", tone: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100", activeTone: "", dot: "bg-fuchsia-300" },
                        { key: null, title: "Broadcasts", tone: "border-amber-400/30 bg-amber-500/10 text-amber-100", activeTone: "", dot: "bg-amber-300" },
                        { key: null, title: "Announcements", tone: "border-rose-400/30 bg-rose-500/10 text-rose-100", activeTone: "", dot: "bg-rose-300" },
                      ].map((group) => {
                        // Only the jingles pad uses this button — equality
                        // compare against the string literal keeps the
                        // check narrow and side-steps the richer object
                        // shapes that `CenterModule` now supports (e.g.
                        // the player's edit-current target).
                        const isActive = group.key === "jingles" && isJinglesModule(activeCenterModule);
                        return (
                          <button
                            key={group.title}
                            type="button"
                            className={`rounded-xl border px-2.5 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition ${isActive ? group.activeTone : group.tone}`}
                            disabled={group.key === null}
                            aria-disabled={group.key === null}
                            aria-pressed={group.key !== null ? isActive : undefined}
                            onClick={
                              group.key === "jingles"
                                ? () =>
                                    setActiveCenterModule((v) =>
                                      isJinglesModule(v) ? null : "jingles",
                                    )
                                : undefined
                            }
                          >
                            <p className="text-xs font-semibold tracking-tight">{group.title}</p>
                            <p className="mt-1 flex items-center gap-1 text-[10px] opacity-90">
                              <span className={`h-1.5 w-1.5 rounded-full ${group.dot}`} />
                              {group.key !== null ? (isActive ? "Close console" : "Open console") : "Soon"}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </aside>
              ) : null}
            </div>
            </div>
          </div>
        </header>

        <main
          className={`flex-1 px-4 pb-4 sm:px-6${isSourcesLibraryRoute ? " pt-4" : " py-5"}${isMediaThemeRoute ? " library-main-below-deck" : ""}`}
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
    </CenterModuleContext.Provider>
  );
}
