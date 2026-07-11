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
      className="flex min-h-[min(480px,calc(100vh-14rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c10]/95"
      dir={dir}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-[#f5f5f7]">{t.title}</h2>
          <p className="mt-1 text-xs text-[#6e6e73]">{t.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#a1a1a6] transition-colors hover:bg-white/[0.08] hover:text-white"
          aria-label={t.closeAria}
        >
          ✕
        </button>
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
