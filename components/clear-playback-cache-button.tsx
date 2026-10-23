"use client";

import { useState } from "react";
import { clearClientPlaybackCache, usePlayback } from "@/lib/playback-provider";

/**
 * Clears `syncbiz-playback-recovery-v2` and session `syncbiz-playback`, then
 * stops the current session so the player does not keep the old source in memory.
 */
export function ClearPlaybackCacheButton() {
  const { stop } = usePlayback();
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm text-slate-200">Clear saved playback in this browser</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Removes the recovery cache for “resume after refresh” and the session snapshot. The next load
          will start with an empty player until you play something new.
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => {
            clearClientPlaybackCache();
            stop();
            setNote("Cleared. You can keep working or refresh the page.");
            window.setTimeout(() => setNote(null), 5000);
          }}
          className="rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800"
        >
          Clear playback memory
        </button>
        {note && <p className="text-[11px] text-emerald-400/95">{note}</p>}
      </div>
    </div>
  );
}
