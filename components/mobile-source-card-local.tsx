"use client";

import { usePlayback } from "@/lib/playback-provider";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { MobileSourceCardActions } from "@/components/mobile-source-card-actions";
import type { UnifiedSource } from "@/lib/source-types";

type Props = {
  source: UnifiedSource;
  onRemove?: (id: string, origin?: UnifiedSource["origin"]) => void;
  editReturnTo?: string;
};

/** Compact source card for mobile Player mode – plays locally on the phone. */
export function MobileSourceCardLocal({ source, onRemove, editReturnTo }: Props) {
  const { playSource, currentSource } = usePlayback();

  const active = currentSource?.id === source.id;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    playSource(source);
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
        active ? "border-emerald-500/50 bg-emerald-500/10" : "border-slate-700/60 bg-slate-900/40"
      }`}
    >
      <button
        type="button"
        onClick={handlePlay}
        className={`flex min-w-0 flex-1 items-center gap-3 text-left transition active:scale-[0.98] ${
          active ? "text-emerald-200" : ""
        }`}
      >
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-800/80">
          {source.cover ? (
            <HydrationSafeImage src={source.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-800 text-slate-500">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">{source.title}</p>
          {source.genre && source.genre !== "Mixed" && (
            <p className="truncate text-xs text-slate-400">{source.genre}</p>
          )}
          <p className="truncate text-[10px] text-slate-500">
            {source.origin === "radio"
              ? "Radio"
              : source.playlist?.tracks && source.playlist.tracks.length > 1
                ? `${source.playlist.tracks.length} tracks`
                : "Stream"}
          </p>
        </div>
        <div className="shrink-0">
          {active ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/30 text-emerald-400">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </span>
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700/80 text-slate-300">
              <svg className="ml-0.5 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          )}
        </div>
      </button>
      <MobileSourceCardActions source={source} onRemove={onRemove} isControllerMode={false} editReturnTo={editReturnTo} />
    </div>
  );
}
