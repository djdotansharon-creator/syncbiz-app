"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useLocale, useTranslations, type Locale } from "@/lib/locale-context";
import { labels } from "@/lib/locale-context";
import { useLibraryTheme } from "@/lib/library-theme-context";
import { AudioPlayer } from "@/components/audio-player";
import { LiveQueuePanel } from "@/components/live-queue-panel";
import { usePlayback } from "@/lib/playback-provider";
import { canonicalYouTubeWatchUrlForPlayback, getYouTubeThumbnail, getYouTubeVideoId, inferPlaylistType } from "@/lib/playlist-utils";
import { createPlaylistFromUrl, resolveYouTubePlayableUrlForSearch } from "@/lib/search-playlist-client";
import { urlTimingMark, urlTimingStart, urlTimingSummary } from "@/lib/url-startup-timing";
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
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { DesktopDownloadButton } from "@/components/desktop-download-button";
import { DesktopUpdatePill } from "@/components/desktop-update-pill";
import { CenterModuleContext, type CenterModule, isJinglesModule, isMyMusicLibraryModule } from "@/lib/center-module-context";
import { MainMenuPopover, type MainMenuItem } from "@/components/main-menu-popover";
import { useTopNavPins } from "@/lib/use-top-nav-pins";
import {
  buildEphemeralLocalFolderPlaylist,
  buildEphemeralLocalQueueFromPaths,
  ephemeralLocalSourceWithCover,
} from "@/lib/ephemeral-local-music-playback";
import {
  LOCAL_PLAYLIST_ARTWORK_PLACEHOLDER,
  MAX_EPHEMERAL_TRACK_COVERS_ON_DROP,
  embedLocalTrackCoversUpToCap,
  pickFirstEmbeddedLocalCover,
} from "@/lib/local-playlist-artwork";
import {
  collectElectronFilePathsFromDataTransfer,
  resolveDesktopFolderDropPath,
  titleFromLocalPath,
} from "@/lib/local-audio-path";
import { SYNCBIZ_MUSIC_LIBRARY_DRAG_MIME, type MusicLibraryDragPayload } from "@/lib/music-library-drag";
import { derivePlaylistUnifiedCoverArt, unifiedPlaylistSourceId } from "@/lib/playlist-utils";

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
function IconFullscreenEnter() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}
function IconFullscreenExit() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
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

function LogoutButton({ compact: isCompact }: { compact?: boolean } = {}) {
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
      {isCompact ? (
        /* Compact icon-only variant for the unified header right cluster */
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={loading}
          aria-label={t.logout ?? "Log out"}
          title={t.logout ?? "Log out"}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 bg-slate-900/80 text-slate-400 transition hover:border-slate-700 hover:bg-slate-800 hover:text-rose-300 focus:outline-none focus:ring-2 focus:ring-sky-400/40 disabled:opacity-50"
        >
          {/* Exit/logout door icon */}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={loading}
          className="logout-led-button inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-[#a1a1a6] transition-colors duration-150 hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-white/20 active:scale-[0.97] disabled:opacity-50"
        >
          <span aria-hidden className="inline-flex h-1.5 w-1.5 rounded-full bg-[#6e6e73]" />
          {loading ? "…" : "Logout"}
        </button>
      )}
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

/**
 * HeaderProfileButton — compact avatar that opens a portal dropdown
 * with user info, workspace switcher, and logout.
 * Rendered inside the unified header right cluster.
 */
type WorkspaceEntry = { id: string; name: string };

function HeaderProfileButton({
  sessionName,
  sessionAccountName,
  timeStr,
  workspaceList,
  activeWorkspaceId,
  locale,
}: {
  sessionName?: string | null;
  sessionAccountName?: string | null;
  timeStr: string;
  workspaceList?: WorkspaceEntry[] | null;
  activeWorkspaceId?: string | null;
  locale: string;
}) {
  const router = useRouter();
  const { t } = useTranslations();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open || !btnRef.current) { setCoords(null); return; }
    const rect = btnRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.closest("[data-profile-panel-root]")?.contains(e.target as Node)) {
        if (!btnRef.current.contains(e.target as Node)) setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleLogout() {
    setLogoutLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLogoutLoading(false);
    }
  }

  const initials = sessionName
    ? sessionName.split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()
    : "••";

  const dropdown =
    mounted && open && coords
      ? createPortal(
          <div
            data-profile-panel-root
            style={{ position: "fixed", top: coords.top, right: coords.right, zIndex: 70 }}
            className="w-56 rounded-xl border border-slate-700/60 bg-slate-900/98 shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-sm"
          >
            {/* User info */}
            <div className="flex items-start gap-2.5 px-4 py-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-semibold text-sky-200 ring-1 ring-sky-500/30">
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                {sessionName && (
                  <p className="truncate text-[12px] font-semibold leading-tight text-slate-100">{sessionName}</p>
                )}
                {sessionAccountName && (
                  <p className="truncate text-[11px] leading-snug text-slate-400">{sessionAccountName}</p>
                )}
                <p className="mt-1 tabular-nums text-[11px] text-slate-500" suppressHydrationWarning>
                  {timeStr}
                </p>
              </div>
            </div>

            {/* Workspace switcher (only when multiple workspaces) */}
            {activeWorkspaceId && workspaceList && workspaceList.length > 1 && (
              <div className="border-t border-slate-700/50 px-4 py-2.5" dir={locale === "he" ? "rtl" : "ltr"}>
                <WorkspaceSwitcher workspaces={workspaceList} activeId={activeWorkspaceId} />
              </div>
            )}

            {/* Logout row */}
            <div className="border-t border-slate-700/50 p-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setLogoutConfirmOpen(true); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-slate-400 transition hover:bg-slate-800/80 hover:text-rose-300 focus:outline-none"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {t.logout ?? "Log out"}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={sessionName ?? "Profile"}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-sky-400/40 ${
          open
            ? "bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/50"
            : "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30 hover:bg-sky-500/25 hover:ring-sky-400/50"
        }`}
      >
        {initials}
      </button>
      {dropdown}
      <DeleteConfirmModal
        isOpen={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
        title={t.logoutConfirmTitle}
        message={t.logoutConfirm}
        confirmLabel={t.confirmLogout}
        loading={logoutLoading}
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
  const [workspaceList, setWorkspaceList] = useState<Array<{ id: string; name: string }> | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
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
      .then((data: {
        name?: string | null;
        email?: string | null;
        accountName?: string | null;
        workspaces?: Array<{ id: string; name: string }>;
        tenantId?: string | null;
      } | null) => {
        if (cancelled || !data) return;
        const displayName = (data.name ?? "").trim() || (data.email ?? "").trim() || null;
        setSessionName(displayName);
        setSessionAccountName((data.accountName ?? "").trim() || null);
        setWorkspaceList(Array.isArray(data.workspaces) ? data.workspaces : []);
        setActiveWorkspaceId(typeof data.tenantId === "string" ? data.tenantId : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const timeStr = now.toLocaleTimeString(locale === "he" ? "he-IL" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const activeWorkspaceName =
    activeWorkspaceId && workspaceList
      ? (workspaceList.find((w) => w.id === activeWorkspaceId)?.name ?? null)
      : null;

  /** Full-width main under the deck — same shell as library (workspace routes + library). */
  const isLibraryPlayerMainFullWidth = (() => {
    const p = pathname ?? "";
    if (!p) return false;
    if (p.startsWith("/sources")) return true;
    if (/^\/playlists\/[^/]+\/edit(\/|$)/.test(p)) return true;
    if (p === "/dashboard" || p === "/owner" || p === "/logs" || p === "/settings") return true;
    if (p === "/radio") return true;
    if (p.startsWith("/schedules")) return true;
    return false;
  })();
  // Unified deck treatment: every desktop (app) route gets the media-theme
  // player shell — hero card + Command Pads aside + library-theme tokens —
  // so the top bar looks identical on /library, /radio, /owner, /schedules,
  // /logs, /remote, etc. The mobile layout short-circuits above (see
  // `isMobileOrEditFromMobile` branch), so this flag is only read on
  // desktop routes.
  const isMediaThemeRoute = true;
  const { libraryTheme } = useLibraryTheme();
  const { playSource, setQueue, setUrlPrepareActive, setLastMessage } = usePlayback();
  const [playerDropActive, setPlayerDropActive] = useState(false);
  const [activeCenterModule, setActiveCenterModule] = useState<CenterModule>(null);
  // ─── Adaptive player size: full / compact / mini ──────────────────────────
  // Measured on the player cell container (ResizeObserver).
  // full ≥700px · compact 500–699px · mini <500px
  type PlayerSize = "full" | "compact" | "mini";
  const [playerSize, setPlayerSize] = useState<PlayerSize>("full");
  const playerCellRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const cell = playerCellRef.current;
    if (!cell || typeof ResizeObserver === "undefined") return;
    const classify = (w: number): PlayerSize => w >= 700 ? "full" : w >= 500 ? "compact" : "mini";
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setPlayerSize(classify(w));
    });
    ro.observe(cell);
    // Seed immediately so first paint gets the right class
    setPlayerSize(classify(cell.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  // ─────────────────────────────────────────────────────────────────────────
  // ─── Diagnostic: log AppShell renders that change pathname ───────────────
  const _shellPathRef = React.useRef("");
  if (_shellPathRef.current !== pathname) {
    console.warn("[SyncBiz DIAG] AppShell pathname change", { prev: _shellPathRef.current, next: pathname, ts: new Date().toISOString() });
    _shellPathRef.current = pathname ?? "";
  }
  // ─── Diagnostic: layout/responsive ResizeObserver ────────────────────────
  const _deckGridRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const BREAKPOINTS = [640, 768, 1024, 1280, 1536];
    const bp = (w: number) => BREAKPOINTS.slice().reverse().find((b) => w >= b) ?? 0;
    const logLayout = (label: string) => {
      const w = window.innerWidth;
      const docW = document.documentElement.clientWidth;
      const scrollbarW = w - docW;
      const grid = _deckGridRef.current;
      const gridH = grid?.getBoundingClientRect().height ?? -1;
      const gridW = grid?.getBoundingClientRect().width ?? -1;
      console.warn(`[SyncBiz DIAG] Layout(${label})`, {
        windowInnerWidth: w,
        docClientWidth: docW,
        scrollbarWidth: scrollbarW,
        breakpoint: bp(w),
        deckGridHeight: gridH,
        deckGridWidth: gridW,
        deckGridZero: gridH === 0 || gridH < 10,
        zoom: Math.round((window.devicePixelRatio / (window as unknown as { screen?: { deviceXDPI?: number; logicalXDPI?: number } }).screen?.deviceXDPI! * (window as unknown as { screen?: { deviceXDPI?: number; logicalXDPI?: number } }).screen?.logicalXDPI!) * 100) / 100,
        ts: new Date().toISOString(),
      });
    };
    // Log initial layout
    logLayout("init");
    // Log on window resize
    const onResize = () => logLayout("resize");
    window.addEventListener("resize", onResize);
    // ResizeObserver on deck grid
    let ro: ResizeObserver | null = null;
    if (_deckGridRef.current && typeof ResizeObserver !== "undefined") {
      let prevH = -1;
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const h = entry.contentRect.height;
          const w = entry.contentRect.width;
          if (Math.abs(h - prevH) > 1) {
            console.warn("[SyncBiz DIAG] DeckGrid ResizeObserver", { height: h, width: w, prevHeight: prevH, collapsed: h < 10, windowInnerWidth: window.innerWidth, breakpoint: bp(window.innerWidth), ts: new Date().toISOString() });
            prevH = h;
          }
        }
      });
      ro.observe(_deckGridRef.current);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ────────────────────────────────────────────────────────────────────────
  const [inDesktopApp, setInDesktopApp] = useState(false);
  const [mainMenuOpen, setMainMenuOpen] = useState(false);
  const mainMenuTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const { isPinned: isCategoryPinned, togglePin: toggleCategoryPin } = useTopNavPins();
  // Control Room / Full Screen mode — visual-only compaction for tablet/desktop.
  // Two independent layers:
  //   1. isNativeFullscreen — actual browser Fullscreen API state.
  //   2. isControlRoomMode  — SyncBiz internal compact layout (works even when
  //      the Fullscreen API is unavailable or rejected). We persist the user's
  //      preference for the *internal* mode only, never the OS fullscreen state.
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const [isControlRoomMode, setIsControlRoomMode] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setInDesktopApp(Boolean(window.syncbizDesktop));
  }, []);
  // Restore Control Room preference on mount. We deliberately do NOT auto-trigger
  // requestFullscreen here — browsers require a user gesture, and re-entering OS
  // fullscreen silently on every refresh would be surprising.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("syncbiz-control-room-mode");
      if (saved === "1") setIsControlRoomMode(true);
    } catch {
      // localStorage may be blocked (private mode, sandbox); ignore silently.
    }
  }, []);
  // Mirror the browser's actual fullscreen state into React. If the user exits
  // via Esc/F11, isNativeFullscreen flips back to false but isControlRoomMode
  // stays unchanged — they're independent layers.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      const fsEl =
        document.fullscreenElement ??
        (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ??
        null;
      setIsNativeFullscreen(Boolean(fsEl));
    };
    handler();
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler as EventListener);
    };
  }, []);
  const toggleControlRoom = React.useCallback(async () => {
    const next = !isControlRoomMode;
    setIsControlRoomMode(next);
    try {
      window.localStorage.setItem("syncbiz-control-room-mode", next ? "1" : "0");
    } catch {
      // ignore persistence errors
    }
    // iOS / iPadOS Safari overlay an unavoidable native "Done"/X exit button on
    // top of the page whenever an element enters Fullscreen via
    // webkitRequestFullscreen. That floating control sits over the player and
    // is not styleable or removable from JS. To honour SyncBiz UX ("one toggle,
    // no floating X"), we skip the native call on iOS/iPadOS and rely on the
    // internal Control Room compact layout alone — which is what actually fixes
    // the tablet-landscape fit. Desktop Chrome / Edge / Firefox / macOS Safari
    // do NOT show such an overlay, so they keep getting native fullscreen.
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    const isIOSLike =
      /iPad|iPhone|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
    if (next) {
      if (isIOSLike) return; // internal Control Room only — no native fullscreen
      const el = shellRef.current as
        | (HTMLDivElement & {
            webkitRequestFullscreen?: () => Promise<void> | void;
          })
        | null;
      if (el) {
        try {
          if (typeof el.requestFullscreen === "function") {
            await el.requestFullscreen();
          } else if (typeof el.webkitRequestFullscreen === "function") {
            await el.webkitRequestFullscreen();
          }
        } catch {
          // Native fullscreen unavailable or rejected — keep internal mode on.
        }
      }
    } else {
      const doc = document as Document & {
        webkitExitFullscreen?: () => Promise<void> | void;
        webkitFullscreenElement?: Element | null;
      };
      const fsEl = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      if (fsEl) {
        try {
          if (typeof document.exitFullscreen === "function") {
            await document.exitFullscreen();
          } else if (typeof doc.webkitExitFullscreen === "function") {
            await doc.webkitExitFullscreen();
          }
        } catch {
          // Ignore — we've already cleared the internal flag.
        }
      }
    }
  }, [isControlRoomMode]);
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
    const parseStarted = typeof performance !== "undefined" ? performance.now() : 0;
    urlTimingMark("parse_start");
    try {
      const res = await fetch("/api/sources/parse-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      const parseMs =
        typeof performance !== "undefined" ? Math.round(performance.now() - parseStarted) : null;
      if (!res.ok) {
        urlTimingMark("parse_done", { ok: false, aborted: false, parseUrlMs: parseMs });
        return null;
      }
      const data = (await res.json()) as ParseUrlJson;
      urlTimingMark("parse_done", {
        ok: true,
        aborted: false,
        parseUrlMs: parseMs,
        type: data.type ?? null,
        note: "server may run yt-dlp for metadata even when client returns",
      });
      return data;
    } catch (err) {
      const parseMs =
        typeof performance !== "undefined" ? Math.round(performance.now() - parseStarted) : null;
      const aborted = err instanceof DOMException && err.name === "AbortError";
      urlTimingMark("parse_done", {
        ok: false,
        aborted,
        parseUrlMs: parseMs,
        note: aborted ? "client_abort_2500ms_server_may_continue" : "fetch_error",
      });
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
    setUrlPrepareActive(true);
    urlTimingStart({ url: trimmed.slice(0, 120) });
    urlTimingMark("playDroppedUrl_entered");
    console.log("[SyncBiz Audit] url_prepare drop_start", { url: trimmed.slice(0, 120) });
    const clearUrlPrepare = (reason: string) => {
      setUrlPrepareActive(false);
      console.log("[SyncBiz Audit] url_prepare cleared", { reason });
    };
    try {
      const ytVideoId = getYouTubeVideoId(trimmed);
      if (ytVideoId) {
        const playableUrl = canonicalYouTubeWatchUrlForPlayback(trimmed);
        urlTimingMark("parse_skipped_fast_path", {
          videoId: ytVideoId,
          reason: "watch_v_present",
          droppedUrl: trimmed.slice(0, 120),
          playableUrl: playableUrl.slice(0, 120),
        });
        console.log("[SyncBiz Audit] url_prepare parse_skipped", {
          fastPath: true,
          videoId: ytVideoId,
          note: "skip parse-url and yt-dlp before first playback",
        });
        urlTimingMark("resolve_start", { apiType: "youtube", hasVideoId: true, fastPath: true });
        urlTimingMark("resolve_done", {
          clientYtDlpSkipped: true,
          ytDlpResolveApiCalled: false,
          playableUrl: playableUrl.slice(0, 120),
          fastPath: true,
        });
        urlTimingMark("create_playlist_start");
        const createStarted = typeof performance !== "undefined" ? performance.now() : 0;
        const created = await createPlaylistFromUrl(playableUrl, {
          title: `YouTube ${ytVideoId}`,
          genre: "Mixed",
          cover: getYouTubeThumbnail(playableUrl),
          type: "youtube",
        });
        if (!created) {
          clearUrlPrepare("playlist_create_failed");
          urlTimingSummary({ outcome: "create_failed", fastPath: true });
          setLastMessage("Failed to add URL");
          return;
        }
        const createMs =
          typeof performance !== "undefined" ? Math.round(performance.now() - createStarted) : null;
        urlTimingMark("create_playlist_done", { playlistId: created.id, createPlaylistMs: createMs, fastPath: true });
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
          fastPath: true,
          videoId: ytVideoId,
        });
        setQueue([unified], { force: true });
        urlTimingMark("playSource_call", { sourceId: unified.id, fastPath: true });
        console.log("[SyncBiz Audit] url_prepare playSource_call", { sourceId: unified.id, fastPath: true });
        playSource(unified);
        return;
      }

      const parsed = await parseDroppedUrl(trimmed);
      console.log("[SyncBiz Audit] url_prepare parse_done", {
        ok: parsed != null,
        type: parsed?.type ?? null,
      });
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
        if (!first) {
          clearUrlPrepare("shazam_no_match");
          setLastMessage("No YouTube match for Shazam link");
          return;
        }
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
        if (!created) {
          clearUrlPrepare("shazam_create_failed");
          setLastMessage("Failed to add URL");
          return;
        }
        console.log("[SyncBiz Audit] url_prepare playlist_created", { playlistId: created.id });
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
        console.log("[SyncBiz Audit] url_prepare playSource_call", { sourceId: unified.id });
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
        if (!res.ok) {
          clearUrlPrepare("radio_create_failed");
          setLastMessage("Failed to add radio station");
          return;
        }
        const station = (await res.json()) as RadioStream;
        const unified = radioToUnified(station);
        saveRadioToLocal(station);
        setQueue([unified], { force: true });
        console.log("[SyncBiz Audit] url_prepare playSource_call", { sourceId: unified.id });
        playSource(unified);
        return;
      }

      urlTimingMark("resolve_start", {
        apiType,
        hasVideoId: !!getYouTubeVideoId(trimmed),
      });
      const playableUrl = apiType === "youtube" ? await resolveYouTubePlayableUrlForSearch(trimmed) : trimmed;
      urlTimingMark("resolve_done", {
        ytDlpResolveApiCalled: apiType === "youtube" && !getYouTubeVideoId(trimmed),
        clientYtDlpSkipped: apiType === "youtube" && !!getYouTubeVideoId(trimmed),
        playableUrl: playableUrl.slice(0, 120),
      });
      urlTimingMark("create_playlist_start");
      const createStarted = typeof performance !== "undefined" ? performance.now() : 0;
      const created = await createPlaylistFromUrl(playableUrl, {
        title: parsed?.title || "Untitled",
        genre: parsed?.genre || "Mixed",
        cover: parsed?.cover || null,
        type: apiType,
        viewCount: parsed?.viewCount,
        durationSeconds: parsed?.durationSeconds,
      });
      if (!created) {
        clearUrlPrepare("playlist_create_failed");
        urlTimingSummary({ outcome: "create_failed" });
        setLastMessage("Failed to add URL");
        return;
      }
      const createMs =
        typeof performance !== "undefined" ? Math.round(performance.now() - createStarted) : null;
      urlTimingMark("create_playlist_done", { playlistId: created.id, createPlaylistMs: createMs });
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
      urlTimingMark("playSource_call", { sourceId: unified.id });
      console.log("[SyncBiz Audit] url_prepare playSource_call", { sourceId: unified.id });
      playSource(unified);
    } catch {
      clearUrlPrepare("error");
      urlTimingSummary({ outcome: "error" });
      setLastMessage("Failed to play URL");
    }
  };

  const handlePlayerDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPlayerDropActive(false);

    const mmlRaw = e.dataTransfer.getData(SYNCBIZ_MUSIC_LIBRARY_DRAG_MIME);
    if (mmlRaw) {
      try {
        const payload = JSON.parse(mmlRaw) as MusicLibraryDragPayload;
        const p = payload.path?.trim();
        if (p && (payload.kind === "folder" || payload.kind === "file")) {
          const api = typeof window !== "undefined" ? window.syncbizDesktop : undefined;
          if (payload.kind === "folder" && api?.scanLocalAudioFolder) {
            const scan = await api.scanLocalAudioFolder(p);
            if (scan.status === "ok" && scan.files.length > 0) {
              const getCov = (fp: string) => api.getLocalAudioCover!(fp);
              const perTrackCovers = api.getLocalAudioCover
                ? await embedLocalTrackCoversUpToCap(getCov, scan.files, MAX_EPHEMERAL_TRACK_COVERS_ON_DROP)
                : [];
              const thumbFromRows = perTrackCovers.find((c) => c && c.trim()) ?? null;
              const thumb =
                thumbFromRows ??
                (api.getLocalAudioCover
                  ? await pickFirstEmbeddedLocalCover(getCov, scan.files, 6)
                  : null) ??
                LOCAL_PLAYLIST_ARTWORK_PLACEHOLDER;
              const playlist = buildEphemeralLocalFolderPlaylist(scan.files, {
                folderLabel: scan.playlistName ?? undefined,
                thumbnail: thumb,
                ...(perTrackCovers.length > 0 ? { perTrackCovers } : {}),
              });
              const unified: UnifiedSource = {
                id: unifiedPlaylistSourceId(playlist.id),
                title: playlist.name,
                genre: playlist.genre || "Mixed",
                cover: derivePlaylistUnifiedCoverArt(playlist),
                type: "local",
                url: playlist.url,
                origin: "playlist",
                playlist,
                ...unifiedFoundationHints("playlist", "local", playlist.url),
              };
              setQueue([unified], { force: true });
              playSource(unified, 0);
            }
            return;
          }
          if (payload.kind === "file") {
            let cover: string | null = null;
            if (api?.getLocalAudioCover) {
              try {
                const cov = await api.getLocalAudioCover(p);
                if (cov.status === "ok") cover = cov.dataUrl;
              } catch {
                cover = null;
              }
            }
            const ephemeral = ephemeralLocalSourceWithCover(p, cover ?? null);
            setQueue([ephemeral], { force: true });
            playSource(ephemeral);
            return;
          }
        }
      } catch {
        // Ignore malformed payload.
      }
    }

    const nativePaths = collectElectronFilePathsFromDataTransfer(e.dataTransfer);
    if (nativePaths.length > 0) {
      const api = typeof window !== "undefined" ? window.syncbizDesktop : undefined;
      if (api?.scanLocalAudioFolder) {
        const rootPath = resolveDesktopFolderDropPath(nativePaths);
        const scan = await api.scanLocalAudioFolder(rootPath);
        let files: string[] = [];
        let label = rootPath.split(/[/\\]/).filter(Boolean).pop() ?? "Local";
        if (scan.status === "ok" && scan.files.length > 0) {
          files = scan.files;
          label = scan.playlistName ?? label;
        } else if (scan.status === "not_directory" && rootPath.trim()) {
          files = [rootPath.trim()];
          label = titleFromLocalPath(rootPath);
        } else if (nativePaths.length === 1) {
          const one = nativePaths[0]!.trim();
          if (one) {
            files = [one];
            label = titleFromLocalPath(one);
          }
        }
        if (files.length > 0) {
          const getCov = (fp: string) => api.getLocalAudioCover!(fp);
          const perTrackCovers = api.getLocalAudioCover
            ? await embedLocalTrackCoversUpToCap(getCov, files, MAX_EPHEMERAL_TRACK_COVERS_ON_DROP)
            : [];
          const thumbFromRows = perTrackCovers.find((c) => c && c.trim()) ?? null;
          const thumb =
            thumbFromRows ??
            (api.getLocalAudioCover
              ? await pickFirstEmbeddedLocalCover(getCov, files, 6)
              : null) ??
            LOCAL_PLAYLIST_ARTWORK_PLACEHOLDER;
          const playlist = buildEphemeralLocalFolderPlaylist(files, {
            folderLabel: label,
            thumbnail: thumb,
            ...(perTrackCovers.length > 0 ? { perTrackCovers } : {}),
          });
          const unified: UnifiedSource = {
            id: unifiedPlaylistSourceId(playlist.id),
            title: playlist.name,
            genre: playlist.genre || "Mixed",
            cover: derivePlaylistUnifiedCoverArt(playlist),
            type: "local",
            url: playlist.url,
            origin: "playlist",
            playlist,
            ...unifiedFoundationHints("playlist", "local", playlist.url),
          };
          setQueue([unified], { force: true });
          playSource(unified, 0);
          return;
        }
      }
    }

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

  // Dedicated branch streamer (GOtv / Android TV): minimal chrome, never mobile controller UI.
  const isStreamerPath = pathname === "/streamer" || (pathname?.startsWith("/streamer/") ?? false);
  if (isStreamerPath) {
    return (
      <>
        <div className="min-h-screen bg-slate-950 text-slate-50">{children}</div>
        <div
          className="fixed bottom-0 right-0 z-0 opacity-0 pointer-events-none"
          aria-hidden
          style={{ width: 320, height: 180 }}
        >
          <AudioPlayer />
        </div>
      </>
    );
  }

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
    <div
      ref={shellRef}
      className={`flex min-h-screen bg-slate-950 text-slate-50${
        isControlRoomMode ? " control-room" : ""
      }${isNativeFullscreen ? " is-native-fullscreen" : ""}`}
      data-control-room={isControlRoomMode ? "true" : undefined}
      data-native-fullscreen={isNativeFullscreen ? "true" : undefined}
    >
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
          {/* ── Single unified header row — three-column flex for reliable centering ── */}
          <div
            className={`flex h-[56px] min-w-0 items-stretch px-4 sm:px-6${
              isMediaThemeRoute ? " sources-app-header-row1" : ""
            }`}
          >
            {/* ── LEFT: Logo — flex-1 basis-0 anchors the three-column balance ── */}
            <div className="flex flex-1 basis-0 items-center min-w-0">
              <Link href="/library" className="flex shrink-0 items-center gap-2" aria-label="SyncBiz">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-[13px] font-semibold text-sky-400 ring-1 ring-sky-500/30">
                  SB
                </span>
                <span className="hidden text-[13px] font-semibold tracking-tight text-slate-50 sm:block">
                  SyncBiz
                </span>
              </Link>
            </div>

            {/* ── CENTER: Nav tabs — perfectly centered between left and right columns ──
                All items always use font-medium + fixed px-3.5 so width never shifts.
                The underline span is always in the DOM (opacity changes only).
                Explicit sort guarantees display order: Library → Schedules → Radio → Settings */}
            <nav className="flex shrink-0 items-end pb-0" aria-label="Main">
              {(() => {
                const NAV_ORDER = ["library", "schedules", "radio", "settings"] as const;
                return navItems
                  .filter((item) => (NAV_ORDER as readonly string[]).includes(item.labelKey))
                  .sort((a, b) => (NAV_ORDER as readonly string[]).indexOf(a.labelKey) - (NAV_ORDER as readonly string[]).indexOf(b.labelKey));
              })()
                .map((item) => {
                  const isActive =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname.startsWith(item.href);
                  const label = labels[item.labelKey]?.[locale] ?? item.labelKey;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`relative px-3.5 pb-[6px] pt-[4px] text-[13px] font-medium transition-colors duration-150 focus:outline-none ${
                        isActive ? "text-slate-50" : "text-slate-500 hover:text-slate-200"
                      }`}
                    >
                      {label}
                      {/* Always rendered — opacity controls visibility to keep layout stable */}
                      <span
                        className={`absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-[#f5f5f7] transition-opacity duration-200 ${
                          isActive ? "opacity-100" : "opacity-0"
                        }`}
                        aria-hidden
                      />
                    </Link>
                  );
                })}
            </nav>

            {/* ── RIGHT: meta chip + operational controls — flex-1 basis-0 justify-end ── */}
            <div className="flex flex-1 basis-0 items-center justify-end gap-2 min-w-0">
              {/* ── Greeting + clock chip — larger, readable, prominent ──
                  sm: time only · md: time · greeting · name · lg: + workspace */}
              <div
                className="me-0.5 hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 py-1.5 sm:flex"
                dir={locale === "he" ? "rtl" : "ltr"}
                suppressHydrationWarning
              >
                <span className="tabular-nums text-[13px] font-semibold text-slate-100" suppressHydrationWarning>
                  {timeStr}
                </span>
                {sessionName ? (
                  <>
                    <span className="text-slate-600" aria-hidden>·</span>
                    <span className="hidden text-[12px] text-slate-300 md:inline">
                      {greeting}
                    </span>
                    <span className="text-slate-600 hidden md:inline" aria-hidden>·</span>
                    <span className="text-[12px] font-medium text-slate-200">
                      {sessionName.split(/\s+/)[0]}
                    </span>
                  </>
                ) : null}
                {activeWorkspaceName && workspaceList && workspaceList.length > 1 ? (
                  <>
                    <span className="text-slate-600 hidden lg:inline" aria-hidden>·</span>
                    <span className="hidden max-w-[72px] truncate text-[11px] text-slate-400 lg:inline">
                      {activeWorkspaceName}
                    </span>
                  </>
                ) : null}
              </div>

              {/* Desktop download — compact icon */}
              <DesktopDownloadButton compact />
              <DesktopUpdatePill />

              {/* MASTER / On Air / device mode indicators */}
              <HeaderDeviceIndicators />

              {/* Agents healthy — quiet chip, small green dot */}
              <span
                className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-[5px] text-[11px] font-medium text-[#a1a1a6] sm:flex"
                title={t.agentsHealthy}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#30d158]" aria-hidden />
                <span className="hidden md:inline">{t.agentsHealthy}</span>
              </span>

              {/* Profile avatar → dropdown with full info + logout */}
              <HeaderProfileButton
                sessionName={sessionName}
                sessionAccountName={sessionAccountName}
                timeStr={timeStr}
                workspaceList={workspaceList}
                activeWorkspaceId={activeWorkspaceId}
                locale={locale}
              />

              {/* Fullscreen / Control Room toggle */}
              <button
                type="button"
                onClick={() => void toggleControlRoom()}
                aria-pressed={isControlRoomMode}
                aria-label={
                  isControlRoomMode
                    ? (t.exitControlRoom ?? "Exit Full Screen")
                    : (t.enterControlRoom ?? "Full Screen")
                }
                title={
                  isControlRoomMode
                    ? (t.exitControlRoom ?? "Exit Full Screen / Control Room")
                    : (t.enterControlRoom ?? "Full Screen / Control Room")
                }
                className={`control-room-toggle inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors duration-150 active:scale-95 ${
                  isControlRoomMode
                    ? "border-[#0a84ff]/40 bg-[#0a84ff]/15 text-[#7db8ff]"
                    : "border-white/[0.08] bg-white/[0.04] text-[#a1a1a6] hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-[#f5f5f7]"
                }`}
              >
                {isControlRoomMode ? <IconFullscreenExit /> : <IconFullscreenEnter />}
              </button>

              {/* Gear / More — Dashboard, Owner, Logs, Access, Architecture */}
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
                      ? "border-[#0a84ff]/40 bg-[#0a84ff]/15 text-[#7db8ff]"
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
                  ? "library-deck-unified overflow-hidden rounded-2xl border border-slate-700/40 bg-[#050914]/95 shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
                  : undefined
              }
            >
            <div
              ref={_deckGridRef}
              className={
                isMediaThemeRoute
                  ? // Live Queue widened from 260/280 -> 300/320 to give the new Time column +
                    // always-on trash icons enough breathing room without truncating titles.
                    // Command Pads (right) keep their original width to avoid disturbing the
                    // existing pad grid; only the left aside grew, balanced against the
                    // flexible 1fr middle column.
                    // lg: (1024 px) = minimum iPad landscape width → 3-column deck activates for
                    // every iPad in landscape (iPad mini 1024 px, Air/standard 1080-1180 px,
                    // Pro 12.9" 1366 px). Portrait tablets (<1024 px) keep the single-column deck.
                    // h-[160px] is the fallback below lg so h-full children never collapse to 0.
                    "grid min-w-0 h-[176px] lg:grid-cols-[270px_minmax(0,1fr)_210px] lg:h-[308px] xl:grid-cols-[290px_minmax(0,1fr)_220px] xl:h-[316px] 2xl:grid-cols-[310px_minmax(0,1fr)_230px] 2xl:h-[324px]"
                  : "grid grid-cols-1"
              }
            >
              {isMediaThemeRoute ? (
                <aside className="library-deck-slot-aside relative z-[60] isolate hidden h-full min-h-0 overflow-hidden lg:block lg:border-e lg:border-slate-800/60">
                  <div className="flex h-full min-h-0 flex-col overflow-hidden p-2.5">
                    <LiveQueuePanel />
                  </div>
                </aside>
              ) : null}
              <div
                ref={isMediaThemeRoute ? playerCellRef : undefined}
                data-player-size={isMediaThemeRoute ? playerSize : undefined}
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
                    ? `library-deck-player-cell relative flex min-h-[160px] flex-col lg:h-full lg:min-h-0 min-w-0 overflow-hidden transition-colors ${
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
                <aside className="library-deck-pads-aside relative z-[60] isolate hidden h-full overflow-hidden lg:block lg:border-s lg:border-slate-800/60">
                  <div className="flex h-full flex-col overflow-hidden p-2.5">
                    <header className="pb-2">
                      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                        Pads
                      </p>
                    </header>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          {
                            key: "jingles" as const,
                            title: "Jingles",
                            tone: "border-white/[0.08] bg-white/[0.04] text-[#a1a1a6] hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-[#f5f5f7]",
                            activeTone: "border-[#0a84ff]/40 bg-[#0a84ff]/12 text-[#7db8ff]",
                            dot: "bg-sky-400",
                          },
                          {
                            key: null,
                            title: "Birthdays",
                            tone: "border-white/[0.05] bg-white/[0.02] text-[#48484d]",
                            activeTone: "",
                            dot: "bg-[#48484d]",
                          },
                          {
                            key: "my-music-library" as const,
                            title: "My Music",
                            tone: "border-white/[0.08] bg-white/[0.04] text-[#a1a1a6] hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-[#f5f5f7]",
                            activeTone: "border-[#0a84ff]/40 bg-[#0a84ff]/12 text-[#7db8ff]",
                            dot: "bg-amber-400",
                          },
                          {
                            key: null,
                            title: "Alerts",
                            tone: "border-white/[0.05] bg-white/[0.02] text-[#48484d]",
                            activeTone: "",
                            dot: "bg-[#48484d]",
                          },
                        ] as const
                      ).map((group) => {
                        const isMusicPad = group.key === "my-music-library";
                        const isJinglesPad = group.key === "jingles";
                        const isActive =
                          (isJinglesPad && isJinglesModule(activeCenterModule)) ||
                          (isMusicPad && isMyMusicLibraryModule(activeCenterModule));
                        const padDisabled = group.key === null || (isMusicPad && !inDesktopApp);
                        return (
                          <button
                            key={group.title}
                            type="button"
                            className={`rounded-lg border px-2 py-2 text-left transition-[border-color,background-color,opacity,box-shadow] duration-150 ${
                              isActive && group.activeTone ? group.activeTone : group.tone
                            } ${padDisabled ? "opacity-45 cursor-default" : "hover:opacity-90 active:opacity-75"}`}
                            disabled={padDisabled}
                            aria-disabled={padDisabled}
                            aria-pressed={!padDisabled && (isJinglesPad || isMusicPad) ? isActive : undefined}
                            onClick={
                              isJinglesPad
                                ? () =>
                                    setActiveCenterModule((v) => (isJinglesModule(v) ? null : "jingles"))
                                : isMusicPad && inDesktopApp
                                  ? () =>
                                      setActiveCenterModule((v) =>
                                        isMyMusicLibraryModule(v) ? null : "my-music-library",
                                      )
                                  : undefined
                            }
                          >
                            <p className="text-xs font-semibold tracking-tight">{group.title}</p>
                            {isMusicPad && !inDesktopApp ? (
                              <p className="mt-1 flex items-center gap-1 text-[10px] opacity-60">
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${group.dot}`} />
                                Desktop only
                              </p>
                            ) : isMusicPad && inDesktopApp ? (
                              <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px] opacity-90">
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${group.dot}`} />
                                {isActive ? "Close panel" : "Open console"}
                              </p>
                            ) : (
                              <p className="mt-1 flex flex-wrap items-center gap-1 text-[10px] opacity-90">
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${group.dot}`} />
                                {isJinglesPad
                                  ? isActive
                                    ? "Close console"
                                    : "Open console"
                                  : "Soon"}
                              </p>
                            )}
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
          className={`flex-1 px-4 pb-4 sm:px-6${isLibraryPlayerMainFullWidth ? " pt-4" : " py-5"}${isMediaThemeRoute ? " library-main-below-deck" : ""}`}
          {...(isMediaThemeRoute ? { "data-library-theme": libraryTheme } : {})}
        >
          <div
            className={
              isLibraryPlayerMainFullWidth ? "mx-auto w-full max-w-none" : "mx-auto max-w-5xl"
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
