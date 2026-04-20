"use client";

/**
 * Center workspace panel for editing the currently-playing item inline,
 * triggered from the player's Edit action. Parallels the Jingles
 * workspace panel — renders on the library page center column while
 * the left (playlists) + right (library) columns stay visible.
 *
 * Picks the correct editor form based on `kind`:
 *   - `playlist` → `<EditPlaylistForm />` (uses `/api/playlists/[id]`)
 *   - `source`   → `<EditSourceForm />`   (uses `/api/sources/[id]`)
 *
 * Radio is intentionally not handled here — it has its own
 * `/radio/[id]/edit` route, and the caller falls back to URL navigation
 * for that origin.
 */

import { EditPlaylistForm } from "@/components/edit-playlist-form";
import { EditSourceForm } from "@/components/edit-source-form";
import type { CenterModuleEditTarget } from "@/lib/center-module-context";

type Props = {
  target: CenterModuleEditTarget;
  onClose: () => void;
};

export function EditCurrentWorkspacePanel({ target, onClose }: Props) {
  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close editor"
      title="Close"
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900/70 text-slate-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_2px_6px_rgba(0,0,0,0.25)] transition hover:border-slate-500/80 hover:bg-slate-800/80 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto p-3 sm:p-4">
      {target.kind === "playlist" ? (
        <EditPlaylistForm
          id={target.id}
          onDone={onClose}
          onCancel={onClose}
          titleAddon={closeButton}
          hideTopBackLink
        />
      ) : (
        <EditSourceForm
          id={target.id}
          onDone={onClose}
          onCancel={onClose}
          titleAddon={closeButton}
          hideTopBackLink
        />
      )}
    </div>
  );
}
