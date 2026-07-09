"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type AiMode = "similar" | "refine" | "expand";

async function postAiBuild(body: Record<string, unknown>): Promise<{ title: string; count: number; shortfall?: string | null }> {
  const res = await fetch("/api/playlists/ai-build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err =
      typeof data.error === "string" && data.error.trim()
        ? data.error.trim()
        : `Request failed (${res.status})`;
    throw new Error(err);
  }
  return {
    title: String(data.title ?? ""),
    count: typeof data.count === "number" ? data.count : Number(data.count) || 0,
    shortfall: data.shortfallExplanation != null ? String(data.shortfallExplanation) : null,
  };
}

/**
 * Inline ⋯ AI actions on SyncBiz playlist shell tiles (similar / refine / expand / send-to-playlist).
 */
export function PlaylistAiShellMenu({
  playlistId,
  playlistName,
  branchId = "default",
  onSendToPlaylist,
}: {
  playlistId: string;
  playlistName?: string;
  branchId?: string;
  /** Opens the playlist-picker to send this playlist's tracks into another playlist. */
  onSendToPlaylist?: () => void;
}) {
  const [busy, setBusy] = useState<AiMode | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [refineDraft, setRefineDraft] = useState("");

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!refineOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setRefineOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [refineOpen]);
  const [toast, setToast] = useState<string | null>(null);

  const fireLibraryUpdated = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("library-updated"));
  };

  const run = useCallback(
    async (mode: AiMode, refinementPrompt?: string) => {
      setBusy(mode);
      setToast(null);
      try {
        const body: Record<string, unknown> = {
          mode,
          seedPlaylistId: playlistId,
          branchId: branchId || "default",
          count: 50,
        };
        if (mode === "refine" && refinementPrompt?.trim()) {
          body.refinementPrompt = refinementPrompt.trim();
        }
        const r = await postAiBuild(body);
        const extras = r.shortfall ? ` (${r.shortfall.slice(0, 120)})` : "";
        setToast(`Created: ${r.title} · ${r.count} tracks${extras}`);
        fireLibraryUpdated();
      } catch (e) {
        setToast(e instanceof Error ? e.message : "AI build failed");
      } finally {
        setBusy(null);
      }
    },
    [playlistId, branchId],
  );

  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <details className="group relative">
        <summary
          className="list-none cursor-pointer rounded-md p-0.5 text-[color:var(--lib-text-secondary)] transition-colors hover:bg-[color:var(--lib-surface-card-hover)] hover:text-cyan-200 [&::-webkit-details-marker]:hidden"
          aria-label={`AI playlist tools${playlistName ? ` for ${playlistName}` : ""}`}
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 text-xs font-bold">
            ⋯
          </span>
        </summary>
        <div className="absolute right-0 z-30 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-slate-700/80 bg-slate-950/98 py-1 text-[11px] shadow-xl backdrop-blur-sm">
          <button
            type="button"
            disabled={busy != null}
            className="block w-full px-3 py-1.5 text-left text-slate-100 hover:bg-slate-800/90 disabled:opacity-45"
            onClick={() => void run("similar")}
          >
            {busy === "similar" ? "…" : "Create similar"}
          </button>
          <button
            type="button"
            disabled={busy != null}
            className="block w-full px-3 py-1.5 text-left text-slate-100 hover:bg-slate-800/90 disabled:opacity-45"
            onClick={() => {
              setRefineDraft("");
              setRefineOpen(true);
            }}
          >
            Improve with AI
          </button>
          <button
            type="button"
            disabled={busy != null}
            className="block w-full px-3 py-1.5 text-left text-slate-100 hover:bg-slate-800/90 disabled:opacity-45"
            onClick={() => void run("expand")}
          >
            {busy === "expand" ? "…" : "Expand to 50 tracks"}
          </button>
          {onSendToPlaylist && (
            <>
              <div className="my-1 border-t border-slate-700/60" />
              <button
                type="button"
                disabled={busy != null}
                className="block w-full px-3 py-1.5 text-left text-slate-100 hover:bg-slate-800/90 disabled:opacity-45"
                onClick={() => onSendToPlaylist()}
              >
                Send to playlist
              </button>
            </>
          )}
        </div>
      </details>

      {/* Centered modal — no backdrop darkening */}
      {mounted && refineOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[9990] flex items-center justify-center"
              style={{ pointerEvents: "none" }}
            >
              <div
                className="pointer-events-auto mx-4 w-full max-w-md rounded-xl border border-slate-600 bg-slate-950 p-4 text-slate-100 shadow-[0_0_0_1px_rgba(100,116,139,0.25),0_32px_64px_rgba(0,0,0,0.7)]"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-sm font-semibold text-white">Improve with AI</p>
                <p className="mt-1 text-[11px] text-slate-400">Adds a refined copy — the original playlist is unchanged.</p>
                <textarea
                  value={refineDraft}
                  onChange={(e) => setRefineDraft(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder={'e.g. "תחדד אותו יותר רגוע ועדכני"'}
                  className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900/90 px-2 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/60"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                    onClick={() => setRefineOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy != null || !refineDraft.trim()}
                    className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40"
                    onClick={() => {
                      const rp = refineDraft.trim();
                      if (!rp) return;
                      setRefineOpen(false);
                      void run("refine", rp);
                    }}
                  >
                    Build
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {toast ? (
        <p className="absolute left-1/2 top-full z-20 mt-1 w-max max-w-[14rem] -translate-x-1/2 rounded bg-slate-900/98 px-2 py-1 text-[9px] text-cyan-100 shadow-md">
          {toast}
        </p>
      ) : null}
    </div>
  );
}
