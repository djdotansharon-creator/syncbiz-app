"use client";

import { useState } from "react";
import { useStationController } from "@/lib/station-controller-context";
import { ShareModal } from "@/components/share-modal";
import { unifiedSourceToShareable } from "@/lib/share-utils";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import type { UnifiedSource } from "@/lib/source-types";

type Props = {
  source: UnifiedSource;
};

/** Compact playlist/source card for mobile – controller mode only, touch-friendly. */
export function MobileSourceCard({ source }: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const station = useStationController();

  const isControllerMode = station.isCrossDevice;
  const active = isControllerMode && station.remoteState?.currentSource?.id === source.id;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isControllerMode) station.sendPlaySource(source);
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
        active ? "border-sky-500/50 bg-sky-500/10" : "border-slate-700/60 bg-slate-900/40"
      }`}
    >
      <button
        type="button"
        onClick={handlePlay}
        disabled={!isControllerMode}
        className={`flex min-w-0 flex-1 items-center gap-3 text-left transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${
          active ? "text-sky-200" : ""
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
        </div>
        <div className="shrink-0">
          {active ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/30 text-sky-400">
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
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700/60 text-slate-400 transition hover:bg-slate-600/80 hover:text-slate-200"
        aria-label="Share"
        title="Share"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </button>
      {shareOpen && (
        <ShareModal
          item={unifiedSourceToShareable(source)}
          fallbackPlaylistId={source.origin === "playlist" ? source.id : undefined}
          fallbackRadioId={source.origin === "radio" && source.radio ? source.radio.id : undefined}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
