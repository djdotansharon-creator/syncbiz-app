"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDuration } from "@/lib/format-utils";
import {
  PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT,
  type Playlist,
} from "@/lib/playlist-types";
import type { YouTubeMixImportCandidate } from "@/lib/yt-dlp-search";

type Props = {
  sourceUrl: string;
  onDismiss: () => void;
  /** When set, called after a successful save (before panel is cleared). No playback. */
  onSaved?: (playlist: Playlist) => void;
};

type LoadState = "loading" | "success" | "error";

/**
 * YouTube Mix / radio import: enumerate, select leaf tracks, save as Ready Playlist via saveOrigin.
 */
export function YouTubeMixImportPanelShell({ sourceUrl, onDismiss, onSaved: onSavedProp }: Props) {
  const preview =
    sourceUrl.length > 96 ? `${sourceUrl.slice(0, 94)}…` : sourceUrl;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [candidates, setCandidates] = useState<YouTubeMixImportCandidate[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** videoIds still shown in the review list (exclude = remove from review). */
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  /** Subset of visible rows selected for save. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [playlistName, setPlaylistName] = useState("Imported mix");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoadState("loading");
    setErrorMessage(null);
    setCandidates([]);
    setHiddenIds(new Set());
    setSelectedIds(new Set());
    setSaveError(null);

    void (async () => {
      try {
        const res = await fetch("/api/sources/youtube-mix-candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: ac.signal,
          body: JSON.stringify({ url: sourceUrl }),
        });
        const data = (await res.json()) as {
          candidates?: YouTubeMixImportCandidate[];
          error?: string;
        };
        if (ac.signal.aborted) return;
        if (!res.ok) {
          setLoadState("error");
          setErrorMessage(
            typeof data.error === "string" ? data.error : "Could not load candidates.",
          );
          return;
        }
        const list = Array.isArray(data.candidates) ? data.candidates : [];
        if (data.error && list.length === 0) {
          setLoadState("error");
          setErrorMessage(data.error);
          return;
        }
        if (list.length === 0) {
          setLoadState("error");
          setErrorMessage("No tracks found for this link.");
          return;
        }
        setCandidates(list);
        setSelectedIds(new Set(list.map((c) => c.videoId)));
        setLoadState("success");
      } catch (e) {
        if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        setLoadState("error");
        setErrorMessage("Could not load candidates.");
      }
    })();

    return () => ac.abort();
  }, [sourceUrl]);

  const visibleCandidates = useMemo(
    () => candidates.filter((c) => !hiddenIds.has(c.videoId)),
    [candidates, hiddenIds],
  );

  const selectedVisible = useMemo(
    () => visibleCandidates.filter((c) => selectedIds.has(c.videoId)),
    [visibleCandidates, selectedIds],
  );

  const trackCountLabel =
    loadState === "loading" ? "…" : loadState === "success" ? String(visibleCandidates.length) : "—";

  const toggleSelected = useCallback((videoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(visibleCandidates.map((c) => c.videoId)));
  }, [visibleCandidates]);

  const clearAllSelected = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const removeFromReview = useCallback((videoId: string) => {
    setHiddenIds((prev) => new Set(prev).add(videoId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(videoId);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    const name = playlistName.trim();
    if (!name || selectedVisible.length === 0 || saving) return;

    const first = selectedVisible[0];
    const tracks = selectedVisible.map((c) => ({
      id: c.videoId,
      name: c.title,
      type: "youtube" as const,
      url: c.url,
      cover: c.thumbnailUrl,
    }));

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          url: first.url,
          genre: "Mixed",
          type: "youtube",
          thumbnail: first.thumbnailUrl,
          viewCount: first.viewCount,
          durationSeconds: first.durationSeconds,
          tracks,
          saveOrigin: PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT,
        }),
      });
      const data = (await res.json()) as Playlist & { error?: string };
      if (!res.ok) {
        setSaveError(
          typeof data.error === "string" ? data.error : "Failed to save playlist.",
        );
        return;
      }
      if (!data?.id) {
        setSaveError("Invalid response from server.");
        return;
      }
      onSavedProp?.(data);
      onDismiss();
    } catch {
      setSaveError("Failed to save playlist.");
    } finally {
      setSaving(false);
    }
  }, [playlistName, selectedVisible, saving, onSavedProp, onDismiss]);

  const canSave =
    loadState === "success" &&
    !saving &&
    playlistName.trim().length > 0 &&
    selectedVisible.length > 0;

  return (
    <section
      className="mt-2 rounded-xl border border-sky-500/30 bg-slate-950/80 ring-1 ring-sky-500/15 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
      aria-labelledby="youtube-mix-import-heading"
      aria-busy={loadState === "loading" || saving}
    >
      <div className="border-b border-slate-800/90 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2
              id="youtube-mix-import-heading"
              className="text-sm font-semibold tracking-tight text-sky-100"
            >
              YouTube Mix import
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Select leaf tracks to save as a Ready Playlist. The mix URL itself is not stored as
              the playlist root.
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={saving}
            className="shrink-0 rounded-lg border border-slate-600/80 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800/90 touch-manipulation disabled:opacity-50"
          >
            Back
          </button>
        </div>
        <p className="mt-2 truncate font-mono text-[10px] text-slate-500" title={sourceUrl}>
          {preview}
        </p>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Track count
          </p>
          <span className="tabular-nums text-sm font-medium text-slate-300">{trackCountLabel}</span>
        </div>

        {loadState === "success" ? (
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Playlist name
            </span>
            <input
              type="text"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-lg border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-1 focus:ring-sky-500/30 disabled:opacity-50"
              placeholder="Playlist name"
            />
          </label>
        ) : null}

        <div
          className="flex min-h-[140px] flex-col rounded-lg border border-dashed border-slate-700/80 bg-slate-900/40 px-3 py-4"
          aria-label="Track list"
        >
          {loadState === "loading" ? (
            <p className="flex flex-1 items-center justify-center text-center text-xs text-slate-400">
              Loading tracks…
            </p>
          ) : loadState === "error" ? (
            <p className="flex flex-1 items-center justify-center text-center text-xs text-amber-400/95">
              {errorMessage ?? "Something went wrong."}
            </p>
          ) : visibleCandidates.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-center text-xs text-slate-500">
              No tracks left in review. Use Back or paste the mix URL again.
            </p>
          ) : (
            <ul className="max-h-[min(360px,50vh)] space-y-2 overflow-y-auto pr-1">
              {visibleCandidates.map((c) => {
                const checked = selectedIds.has(c.videoId);
                return (
                  <li
                    key={c.videoId}
                    className="flex gap-2 rounded-lg border border-slate-800/80 bg-slate-900/50 py-2 pl-2 pr-2"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(c.videoId)}
                        disabled={saving}
                        className="mt-3 h-4 w-4 shrink-0 rounded border-slate-600 text-sky-500 focus:ring-sky-500/40"
                      />
                      <img
                        src={c.thumbnailUrl}
                        alt=""
                        width={80}
                        height={45}
                        className="h-11 w-[4.5rem] shrink-0 rounded object-cover"
                      />
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="line-clamp-2 text-xs font-medium leading-snug text-slate-100">
                          {c.title}
                        </p>
                        <p className="mt-1 truncate font-mono text-[10px] text-slate-500" title={c.url}>
                          {c.url}
                        </p>
                        {(c.durationSeconds != null || c.viewCount != null) && (
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            {c.durationSeconds != null ? formatDuration(c.durationSeconds) : ""}
                            {c.durationSeconds != null && c.viewCount != null ? " · " : ""}
                            {c.viewCount != null
                              ? `${c.viewCount.toLocaleString()} views`
                              : ""}
                          </p>
                        )}
                      </div>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeFromReview(c.videoId)}
                      disabled={saving}
                      className="self-center shrink-0 rounded-md border border-slate-700/90 px-2 py-1 text-[10px] font-medium text-slate-400 transition hover:border-slate-600 hover:text-slate-200 disabled:opacity-50"
                      title="Remove from this review list"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectAllVisible}
            disabled={loadState !== "success" || saving || visibleCandidates.length === 0}
            className="rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600 disabled:pointer-events-none disabled:opacity-40"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={clearAllSelected}
            disabled={loadState !== "success" || saving}
            className="rounded-lg border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-600 disabled:pointer-events-none disabled:opacity-40"
          >
            Clear all
          </button>
        </div>

        <div className="border-t border-slate-800/80 pt-3">
          {saveError ? (
            <p className="mb-2 text-center text-xs text-amber-400" role="alert">
              {saveError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="w-full min-h-[44px] rounded-xl border border-sky-600/50 bg-sky-950/40 px-4 py-2.5 text-sm font-semibold text-sky-100 transition hover:border-sky-500/60 hover:bg-sky-950/60 disabled:pointer-events-none disabled:border-slate-700/80 disabled:bg-slate-800/40 disabled:text-slate-500"
          >
            {saving ? "Saving…" : "Save selected as Ready Playlist"}
          </button>
          <p className="mt-2 text-center text-[10px] text-slate-600">
            {selectedVisible.length} selected · Ready Playlists (import only)
          </p>
        </div>
      </div>
    </section>
  );
}
