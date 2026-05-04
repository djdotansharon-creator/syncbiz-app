"use client";

import Link from "next/link";
import { useMemo, type ReactElement, type DragEvent } from "react";
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

  return (
    <div
      className="flex min-h-[min(480px,calc(100vh-14rem))] flex-col overflow-hidden rounded-2xl border border-amber-500/25 bg-slate-950/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      dir={dir}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-white">{t.title}</h2>
          <p className="mt-1 text-xs text-slate-500">{t.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-slate-300 hover:bg-white/[0.08]"
          aria-label={t.closeAria}
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <button
          type="button"
          onClick={onCreateNew}
          className="flex w-full items-center justify-center rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/20 via-amber-400/15 to-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-50 shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:border-amber-400/60 hover:from-amber-500/30 hover:to-amber-500/30"
        >
          {t.createNew}
        </button>

        {rows.length === 0 ? (
          <p className="mt-6 text-center text-sm text-slate-500">{t.empty}</p>
        ) : (
          <ul className="mt-5 space-y-2">
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
                  className="flex cursor-grab items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 active:cursor-grabbing"
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-slate-900">
                    {cover ? (
                      <HydrationSafeImage src={cover} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-600">
                        —
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">{s.title}</p>
                    <p className="text-[11px] text-slate-500">{t.trackCount(n)}</p>
                  </div>
                  <button
                    type="button"
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayPlaylist(s);
                    }}
                    className="shrink-0 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-100 hover:border-emerald-400/55 hover:bg-emerald-500/20"
                  >
                    {t.playPlaylist}
                  </button>
                  <Link
                    href={`/playlists/${encodeURIComponent(pid)}/edit`}
                    draggable={false}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:border-cyan-400/55 hover:bg-cyan-500/20"
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
