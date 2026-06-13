"use client";

import { useMemo, type ReactElement, type DragEvent } from "react";
import type { UnifiedSource } from "@/lib/source-types";
import { useLocale } from "@/lib/locale-context";
import { DjCreatorAiPlaylistList } from "@/components/dj-creator-ai-playlist-list";
import {
  AI_PLAYLIST_GENRE,
  isDjCreatorAiWorkspacePlaylist,
  playlistGenreLabel,
} from "@/lib/dj-creator-playlist-scope";

type HubCopy = {
  title: string;
  subtitle: string;
  closeAria: string;
  createNew: string;
  aiCount: (n: number) => string;
  savedCount: (n: number) => string;
};

const HUB_EN: HubCopy = {
  title: "Your playlists",
  subtitle: "AI-built and DJ Creator playlists you saved appear here.",
  closeAria: "Close DJ Creator playlists",
  createNew: "Build another playlist",
  aiCount: (n) => `AI Playlists: ${n}`,
  savedCount: (n) => `DJ Creator: ${n}`,
};

const HUB_HE: HubCopy = {
  title: "הפלייליסטים שלי",
  subtitle: "כאן מופיעים פלייליסטים שנבנו על־ידי DJ Creator AI.",
  closeAria: "סגירת פלייליסטי DJ Creator",
  createNew: "בנה פלייליסט נוסף",
  aiCount: (n) => `פלייליסטים שנבנו על־ידי AI: ${n}`,
  savedCount: (n) => `שמורים ידנית: ${n}`,
};

export function DjCreatorHubPanel({
  playlists,
  onClose,
  onCreateNew,
  onPlaylistDragStart,
  onOpenPlaylist,
  onSourcesChange,
}: {
  playlists: UnifiedSource[];
  onClose: () => void;
  onCreateNew: () => void;
  onPlaylistDragStart: (e: DragEvent<HTMLElement>, source: UnifiedSource) => void;
  /** Open the playlist's track list in the library (selects the playlist container). */
  onOpenPlaylist?: (source: UnifiedSource) => void;
  onSourcesChange: (updater: (prev: UnifiedSource[]) => UnifiedSource[]) => void;
}): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HUB_HE : HUB_EN;
  const dir: "rtl" | "ltr" = he ? "rtl" : "ltr";

  const { aiCount, savedCount } = useMemo(() => {
    let ai = 0;
    let saved = 0;
    for (const src of playlists) {
      if (!isDjCreatorAiWorkspacePlaylist(src)) continue;
      if (playlistGenreLabel(src) === AI_PLAYLIST_GENRE) ai++;
      else saved++;
    }
    return { aiCount: ai, savedCount: saved };
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
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-slate-400">
            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-[2px] text-amber-300 ring-1 ring-amber-500/30">
              {t.aiCount(aiCount)}
            </span>
            {savedCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-sky-500/10 px-2 py-[2px] text-sky-300 ring-1 ring-sky-500/30">
                {t.savedCount(savedCount)}
              </span>
            ) : null}
          </p>
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

        <DjCreatorAiPlaylistList
          sources={playlists}
          onSourcesChange={onSourcesChange}
          onDragStart={onPlaylistDragStart}
          onOpenPlaylist={onOpenPlaylist}
          showSectionTitle={false}
        />
      </div>
    </div>
  );
}
