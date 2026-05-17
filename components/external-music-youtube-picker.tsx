"use client";

import { useCallback, type ReactElement } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import type { ParseUrlJson } from "@/lib/source-types";
import type { YouTubeSearchResult } from "@/lib/search-service";
import { youtubeOfficialDisplayRank } from "@/lib/m3u-youtube-bulk-confidence";
import { formatDurationClock } from "@/lib/format-utils";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { TrackMediaPlaceholder } from "@/components/track-source-visual";

/** Library Add row — pasted storefront URL → narrowed YouTube options (Stage 6C). */
export type ExternalMusicYtResolvePack = {
  sourceUrl: string;
  parsed: ParseUrlJson;
  searchQuery: string;
  candidates: YouTubeSearchResult[];
};

function officialFlavorLabel(title: string): string | null {
  const t = title.trim();
  if (!t) return null;
  if (/\bofficial\s+(music\s+)?video\b/i.test(t) || (/\bofficial\b/i.test(t) && /\bvideo\b/i.test(t))) {
    return "Official video";
  }
  if (/\bofficial\s+audio\b/i.test(t)) return "Official audio";
  if (/\s-\s*topic\b/i.test(t.toLowerCase()) || /\byoutube\s+music\b/i.test(t.toLowerCase())) {
    return "Topic";
  }
  if (/\bvevo\b/i.test(t.toLowerCase())) return "VEVO";
  if (youtubeOfficialDisplayRank(t) >= 1) return "Official";
  return null;
}

export function ExternalMusicYoutubePickerPanel({
  pack,
  saveBusy,
  onDismiss,
  onPick,
}: {
  pack: ExternalMusicYtResolvePack;
  saveBusy: boolean;
  onDismiss: () => void;
  onPick: (candidate: YouTubeSearchResult) => void;
}): ReactElement {
  const handlePick = useCallback(
    (c: YouTubeSearchResult) => {
      if (saveBusy) return;
      onPick(c);
    },
    [onPick, saveBusy],
  );

  const head = pack.parsed.title?.trim() || "External track";

  return (
    <div
      className="mt-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.07] px-3 py-2.5 text-sm text-cyan-50/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      role="dialog"
      aria-labelledby="external-yt-picker-title"
      aria-busy={saveBusy}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 gap-y-2">
        <div className="min-w-0 flex-1 leading-relaxed">
          <p id="external-yt-picker-title" className="font-semibold text-white/95">
            Choose a YouTube match
          </p>
          <p className="mt-1 text-xs text-cyan-100/80">
            <span className="text-white/85">From link:</span> {head}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-cyan-100/65" title={pack.sourceUrl}>
            Query: “{pack.searchQuery}”
          </p>
        </div>
        <button
          type="button"
          disabled={saveBusy}
          onClick={() => onDismiss()}
          className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-medium text-white/90 hover:bg-white/10 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>

      <ul className="mt-2.5 flex flex-col gap-2">
        {pack.candidates.map((c) => {
          const flavor = officialFlavorLabel(c.title);
          const vidKey = getYouTubeVideoId(c.url ?? "") ?? "";
          return (
          <li key={vidKey || c.url}>
            <button
              type="button"
              disabled={saveBusy}
              onClick={() => handlePick(c)}
              className="flex w-full items-start gap-2.5 rounded-lg border border-slate-700/85 bg-slate-950/50 px-2.5 py-2 text-left transition hover:border-[#1ed760]/45 hover:bg-slate-900/65 disabled:pointer-events-none disabled:opacity-40"
            >
              <div className="relative mt-0.5 h-12 w-[4.75rem] shrink-0 overflow-hidden rounded-md bg-slate-900/80 ring-1 ring-black/35">
                {c.cover?.trim() ? (
                  <HydrationSafeImage
                    src={c.cover}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <TrackMediaPlaceholder chip="YT" className="h-full w-full opacity-95" aria-hidden />
                )}
              </div>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-100">{c.title}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {flavor ? (
                    <span className="rounded border border-emerald-500/35 bg-emerald-500/[0.1] px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/95">
                      {flavor}
                    </span>
                  ) : null}
                  {(c.durationSeconds ?? 0) > 0 ? (
                    <span className="rounded border border-slate-700/85 px-1.5 py-0 text-[10px] font-medium text-slate-300/95">
                      {formatDurationClock(c.durationSeconds ?? 0)}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
          );
        })}
      </ul>
      {saveBusy ? (
        <p className="mt-2 text-xs font-medium text-cyan-200/90" aria-live="polite">
          Saving playlist…
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-snug text-cyan-100/55">
          The original music link will not be saved — only your chosen YouTube video.
        </p>
      )}
    </div>
  );
}
