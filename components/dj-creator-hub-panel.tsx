"use client";

import Link from "next/link";
import { useMemo, useState, type ReactElement, type DragEvent } from "react";
import type { UnifiedSource } from "@/lib/source-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { useLocale } from "@/lib/locale-context";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";

type HubCopy = {
  title: string;
  subtitle: string;
  closeAria: string;
  createNew: string;
  empty: string;
  openPlaylist: string;
  playPlaylist: string;
  trackCount: (n: number) => string;
};

const HUB_EN: HubCopy = {
  title: "DJ Creator playlists",
  subtitle: "Sets you saved from the DJ Creator assistant appear here.",
  closeAria: "Close DJ Creator playlists",
  createNew: "Create new with DJ Creator",
  empty: "No DJ Creator playlists yet — start the assistant and save a draft.",
  openPlaylist: "Open playlist",
  playPlaylist: "Play",
  trackCount: (n) => `${n} track${n === 1 ? "" : "s"}`,
};

const HUB_HE: HubCopy = {
  title: "פלייליסטים מ־DJ Creator",
  subtitle: "סטים ששמרתם מהעוזר מופיעים כאן.",
  closeAria: "סגירת פלייליסטי DJ Creator",
  createNew: "יצירה חדשה עם DJ Creator",
  empty: "עדיין אין פלייליסטים — פתחו את העוזר ושמרו טיוטה.",
  openPlaylist: "פתיחת הפלייליסט",
  playPlaylist: "נגן",
  trackCount: (n) => `${n} רצועות`,
};

export function DjCreatorHubPanel({
  playlists,
  onClose,
  onCreateNew,
  onPlayPlaylist,
  onPlaylistDragStart,
}: {
  playlists: UnifiedSource[];
  onClose: () => void;
  onCreateNew: () => void;
  onPlayPlaylist: (source: UnifiedSource) => void;
  onPlaylistDragStart: (e: DragEvent<HTMLElement>, source: UnifiedSource) => void;
}): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HUB_HE : HUB_EN;
  const dir: "rtl" | "ltr" = he ? "rtl" : "ltr";

  const rows = useMemo(() => {
    return [...playlists].filter((s) => s.playlist?.id);
  }, [playlists]);

  /* Grid (default) / List — same two views as the main library. */
  const [view, setView] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid";
    return localStorage.getItem("syncbiz-djhub-view") === "list" ? "list" : "grid";
  });
  const pickView = (v: "grid" | "list") => {
    setView(v);
    try {
      localStorage.setItem("syncbiz-djhub-view", v);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="sb-anim-rise flex min-h-[min(480px,calc(100vh-14rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c10]/95"
      dir={dir}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-[#f5f5f7]">{t.title}</h2>
          <p className="mt-1 text-xs text-[#6e6e73]">{t.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center overflow-hidden rounded-lg border border-white/[0.08]">
            <button
              type="button"
              onClick={() => pickView("grid")}
              aria-pressed={view === "grid"}
              aria-label="Grid view"
              title="Grid"
              className={`flex h-8 w-9 items-center justify-center transition-colors ${
                view === "grid" ? "bg-white/[0.1] text-white" : "text-[#8e8e93] hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
                <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
                <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
                <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => pickView("list")}
              aria-pressed={view === "list"}
              aria-label="List view"
              title="List"
              className={`flex h-8 w-9 items-center justify-center transition-colors ${
                view === "list" ? "bg-white/[0.1] text-white" : "text-[#8e8e93] hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#a1a1a6] transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label={t.closeAria}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <button
          type="button"
          onClick={onCreateNew}
          className="flex w-full items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.06] px-4 py-3 text-sm font-semibold text-[#f5f5f7] transition-colors hover:border-white/[0.18] hover:bg-white/[0.1]"
        >
          {t.createNew}
        </button>

        {rows.length === 0 ? (
          <p className="mt-6 text-center text-sm text-[#6e6e73]">{t.empty}</p>
        ) : view === "grid" ? (
          <div className="library-source-card-grid mt-5">
            {rows.map((s) => {
              const pid = s.playlist!.id!;
              const cover = s.cover?.trim() || null;
              const n = getPlaylistTracks(s.playlist!).length;
              return (
                <div key={pid} className="relative w-full min-w-0">
                  <article
                    draggable
                    onDragStart={(e) => onPlaylistDragStart(e, s)}
                    onDoubleClick={() => onPlayPlaylist(s)}
                    className="library-source-card group flex h-auto min-h-0 w-full cursor-grab flex-col overflow-hidden rounded-xl transition-transform duration-200 ease-out hover:-translate-y-px active:cursor-grabbing"
                  >
                    <div className="sb-lbc-shell relative flex w-full min-w-0 flex-col overflow-hidden">
                      <div className="sb-lbc-art relative w-full overflow-hidden">
                        <span className="library-card-kind-badge library-card-kind-badge--list absolute left-1.5 top-1.5 z-10">
                          DJ AI
                        </span>
                        {cover ? (
                          <HydrationSafeImage
                            src={cover}
                            alt=""
                            draggable={false}
                            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[#101014] text-[#48484d]">
                            <svg className="h-9 w-9 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                              <path d="M9 18V5l12-2v13" />
                              <circle cx="6" cy="18" r="3" />
                              <circle cx="18" cy="16" r="3" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="sb-lbc-body">
                        <div className="sb-lbc-title-row">
                          <h3 className="sb-lbc-title">{s.title}</h3>
                        </div>
                        <div className="library-card-actions-wrap">
                          <div className="library-source-deck-actions flex items-center gap-1">
                            <button
                              type="button"
                              draggable={false}
                              onClick={(e) => {
                                e.stopPropagation();
                                onPlayPlaylist(s);
                              }}
                              aria-label={t.playPlaylist}
                              title={t.playPlaylist}
                              className="inline-flex h-9 w-9 items-center justify-center"
                            >
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                <path d="M8 5v14l11-7L8 5z" />
                              </svg>
                            </button>
                            <Link
                              href={`/playlists/${encodeURIComponent(pid)}/edit`}
                              draggable={false}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={t.openPlaylist}
                              title={t.openPlaylist}
                              className="inline-flex h-9 w-9 items-center justify-center"
                            >
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </Link>
                            <span className="ms-auto text-[10px] tabular-nums text-white/60">{t.trackCount(n)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        ) : (
          <ul className="mt-5 space-y-1.5">
            {rows.map((s) => {
              const pid = s.playlist!.id!;
              const cover = s.cover?.trim() || null;
              const n = getPlaylistTracks(s.playlist!).length;
              return (
                <li
                  key={pid}
                  draggable
                  onDragStart={(e) => onPlaylistDragStart(e, s)}
                  onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button")) return;
                    onPlayPlaylist(s);
                  }}
                  className="flex cursor-grab items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06] active:cursor-grabbing"
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[#101014] ring-1 ring-white/[0.06]">
                    {cover ? (
                      <HydrationSafeImage src={cover} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-[#48484d]">
                        —
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#f5f5f7]">{s.title}</p>
                    <p className="text-[11px] text-[#6e6e73]">{t.trackCount(n)}</p>
                  </div>
                  <button
                    type="button"
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayPlaylist(s);
                    }}
                    className="shrink-0 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-xs font-semibold text-[#111114] transition-colors hover:bg-white"
                  >
                    {t.playPlaylist}
                  </button>
                  <Link
                    href={`/playlists/${encodeURIComponent(pid)}/edit`}
                    draggable={false}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 rounded-full border border-white/[0.1] px-3 py-1.5 text-xs font-medium text-[#a1a1a6] transition-colors hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white"
                  >
                    {t.openPlaylist}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
