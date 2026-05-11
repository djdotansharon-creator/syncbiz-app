"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";
import { mergeM3uLocalsWithYoutubePicks, type M3uYoutubePickForMerge } from "@/lib/m3u-import-youtube-merge";
import {
  classifyTopCandidates,
  isSafeAutoPick,
  narrowYoutubeCandidatesForM3uRow,
  scoreYoutubeCandidateForRow,
} from "@/lib/m3u-youtube-bulk-confidence";
import { searchExternal, type YouTubeSearchResult } from "@/lib/search-service";
import { resolveYouTubePlayableUrlForSearch } from "@/lib/search-playlist-client";
import { formatDuration } from "@/lib/format-utils";
import { getPlaylistTracks, type Playlist, type PlaylistTrack } from "@/lib/playlist-types";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { unifiedSourceFromFetchedPlaylist } from "@/lib/local-music-library-playlist";
import type { UnifiedSource } from "@/lib/source-types";
import type { M3uYoutubeResolveContextState } from "@/lib/m3u-youtube-resolve-shared";
import { TrackMediaPlaceholder } from "@/components/track-source-visual";

export type { M3uYoutubeResolveContextState } from "@/lib/m3u-youtube-resolve-shared";

const BULK_SEARCH_CONCURRENCY = 3;

/** Stored result for one row — short display list only (narrowed upstream). */
type M3uRowCandidateBundle = {
  display: YouTubeSearchResult[];
  primaryWasOfficialRanking: boolean;
};

function bundleDisplay(bundle: M3uRowCandidateBundle | undefined): YouTubeSearchResult[] {
  return bundle?.display ?? [];
}

/** Manual + bulk YouTube match for unresolved M3U rows — shared by Library row and My Music. */
export function M3uYoutubeResolveModal({
  context,
  defaultGenre,
  onClose,
  onPlaylistMerged,
  onApplied,
}: {
  context: M3uYoutubeResolveContextState;
  defaultGenre: string;
  onClose: () => void;
  onPlaylistMerged: (u: UnifiedSource) => void;
  onApplied: (mergedCount: number) => void | Promise<void>;
}): ReactElement {
  const rows = useMemo(
    () => [...context.unresolvedRows].sort((a, b) => a.playlistOrder - b.playlistOrder),
    [context.unresolvedRows],
  );
  const [picksByOrder, setPicksByOrder] = useState<Record<number, M3uYoutubePickForMerge | undefined>>({});
  const [candidatesByOrder, setCandidatesByOrder] = useState<Record<number, M3uRowCandidateBundle>>({});
  const [searchBusyByOrder, setSearchBusyByOrder] = useState<Record<number, boolean>>({});
  const [searchErrByOrder, setSearchErrByOrder] = useState<Record<number, string | undefined>>({});
  const [searchAttemptedByOrder, setSearchAttemptedByOrder] = useState<Record<number, boolean>>({});
  const [bulkFinding, setBulkFinding] = useState(false);
  const [applySafeBusy, setApplySafeBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !applyBusy && !bulkFinding && !applySafeBusy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, applyBusy, bulkFinding, applySafeBusy]);

  const countPicks = useMemo(() => Object.values(picksByOrder).filter(Boolean).length, [picksByOrder]);

  const runSearchOneRow = useCallback(
    async (order: number, q: string): Promise<boolean> => {
      const query = q.trim();
      if (query.length < 2) {
        setSearchErrByOrder((prev) => ({ ...prev, [order]: "Search text is too short." }));
        setSearchAttemptedByOrder((prev) => ({ ...prev, [order]: true }));
        return false;
      }
      setSearchBusyByOrder((prev) => ({ ...prev, [order]: true }));
      setSearchErrByOrder((prev) => ({ ...prev, [order]: undefined }));
      try {
        const external = await searchExternal(query);
        const yt = external.youtube.filter((r) => r.type === "youtube");
        const row = rows.find((r) => r.playlistOrder === order);
        const bundle = row ? narrowYoutubeCandidatesForM3uRow(row, yt) : { display: [] as YouTubeSearchResult[], primaryWasOfficialRanking: false };
        setCandidatesByOrder((prev) => ({ ...prev, [order]: bundle }));
        setSearchAttemptedByOrder((prev) => ({ ...prev, [order]: true }));
        if (bundle.display.length === 0) {
          setSearchErrByOrder((prev) => ({ ...prev, [order]: "No YouTube hits for this query." }));
        }
        return bundle.display.length > 0;
      } catch {
        setSearchErrByOrder((prev) => ({ ...prev, [order]: "Search failed." }));
        setSearchAttemptedByOrder((prev) => ({ ...prev, [order]: true }));
        return false;
      } finally {
        setSearchBusyByOrder((prev) => ({ ...prev, [order]: false }));
      }
    },
    [rows],
  );

  const runSearchRow = useCallback(
    async (order: number, q: string) => {
      await runSearchOneRow(order, q);
    },
    [runSearchOneRow],
  );

  const bulkSummary = useMemo(() => {
    let notFound = 0;
    let needsReview = 0;
    let safeAutoReady = 0;
    let pendingSearch = 0;

    for (const row of rows) {
      const o = row.playlistOrder;
      if (picksByOrder[o]) continue;
      const cands = bundleDisplay(candidatesByOrder[o]);
      const attempted = searchAttemptedByOrder[o] ?? false;
      if (cands.length === 0) {
        if (!attempted) pendingSearch++;
        else notFound++;
      } else if (isSafeAutoPick(row, cands)) {
        safeAutoReady++;
      } else {
        needsReview++;
      }
    }

    return {
      missingTotal: rows.length,
      selectedCount: countPicks,
      notFound,
      needsReview,
      safeAutoReady,
      pendingSearch,
    };
  }, [rows, candidatesByOrder, picksByOrder, searchAttemptedByOrder, countPicks]);

  const handleAutoFindAll = useCallback(async () => {
    const toFetch = rows.filter((row) => {
      const o = row.playlistOrder;
      const hasCands = bundleDisplay(candidatesByOrder[o]).length > 0;
      const q = row.suggestedSearchQuery.trim();
      return !hasCands && q.length >= 2;
    });
    if (toFetch.length === 0) return;
    setBulkFinding(true);
    setApplyError(null);
    try {
      for (let i = 0; i < toFetch.length; i += BULK_SEARCH_CONCURRENCY) {
        const chunk = toFetch.slice(i, i + BULK_SEARCH_CONCURRENCY);
        await Promise.all(
          chunk.map((row) => runSearchOneRow(row.playlistOrder, row.suggestedSearchQuery)),
        );
      }
    } finally {
      setBulkFinding(false);
    }
  }, [rows, candidatesByOrder, runSearchOneRow]);

  const handleApplySafeMatches = useCallback(async () => {
    setApplySafeBusy(true);
    setApplyError(null);
    try {
      const additions: Record<number, M3uYoutubePickForMerge> = {};
      for (const row of rows) {
        const o = row.playlistOrder;
        if (picksByOrder[o]) continue;
        const cands = bundleDisplay(candidatesByOrder[o]);
        if (!isSafeAutoPick(row, cands)) continue;
        const { best } = classifyTopCandidates(row, cands);
        if (!best) continue;
        const url = await resolveYouTubePlayableUrlForSearch(best.url);
        additions[o] = {
          url,
          title: best.title.trim() || "YouTube video",
          cover: best.cover,
          durationSeconds: best.durationSeconds,
          viewCount: best.viewCount,
        };
      }
      if (Object.keys(additions).length === 0) return;
      setPicksByOrder((prev) => {
        const next = { ...prev };
        for (const [k, pick] of Object.entries(additions)) {
          next[Number(k)] = pick;
        }
        return next;
      });
    } finally {
      setApplySafeBusy(false);
    }
  }, [rows, candidatesByOrder, picksByOrder]);

  const selectCandidate = useCallback(async (order: number, c: YouTubeSearchResult) => {
    const url = await resolveYouTubePlayableUrlForSearch(c.url);
    setPicksByOrder((prev) => ({
      ...prev,
      [order]: {
        url,
        title: c.title.trim() || "YouTube video",
        cover: c.cover,
        durationSeconds: c.durationSeconds,
        viewCount: c.viewCount,
      },
    }));
  }, []);

  const applyChoices = useCallback(async () => {
    if (countPicks === 0) return;
    setApplyError(null);
    const picks = new Map<number, M3uYoutubePickForMerge>();
    for (const [kStr, pick] of Object.entries(picksByOrder)) {
      if (!pick) continue;
      const ord = Number(kStr);
      if (!Number.isFinite(ord)) continue;
      picks.set(ord, pick);
    }
    setApplyBusy(true);
    try {
      const getRes = await fetch(`/api/playlists/${encodeURIComponent(context.playlistId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!getRes.ok) throw new Error("Could not reload playlist.");
      const current = (await getRes.json()) as Playlist;
      const ordered = getPlaylistTracks(current);
      const localsInOrder = ordered.filter((t): t is PlaylistTrack & { type: "local" } => t.type === "local");

      const merged = mergeM3uLocalsWithYoutubePicks({
        existingLocalTracksInOrder: localsInOrder,
        files: context.files,
        resolvedSourceOrders: context.resolvedSourceOrders,
        picksByPlaylistOrder: picks,
      });

      const putRes = await fetch(`/api/playlists/${encodeURIComponent(context.playlistId)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: merged.tracks,
          order: merged.tracks.map((t) => t.id),
        }),
      });
      if (!putRes.ok) {
        const errBody = await putRes.json().catch(() => ({}));
        const msg = typeof (errBody as { error?: string }).error === "string" ? (errBody as { error: string }).error : "Could not save playlist.";
        throw new Error(msg);
      }
      const updated = (await putRes.json()) as Playlist;
      const unified = unifiedSourceFromFetchedPlaylist(updated, defaultGenre);
      onPlaylistMerged(unified);
      await Promise.resolve(onApplied(countPicks));
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setApplyBusy(false);
    }
  }, [context.playlistId, context.files, context.resolvedSourceOrders, countPicks, defaultGenre, onApplied, onPlaylistMerged, picksByOrder]);

  const bulkControlsDisabled = applyBusy || bulkFinding || applySafeBusy;

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/[0.38]"
        aria-hidden
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !bulkControlsDisabled && !applyBusy) onClose();
        }}
      />
      <div
        className="fixed inset-0 z-[101] flex items-end justify-center p-0 pointer-events-none sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Resolve missing playlist tracks on YouTube"
      >
        <div
          className="pointer-events-auto flex max-h-[min(640px,calc(100vh-24px))] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-950 shadow-xl sm:rounded-2xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-100">Missing tracks on YouTube</p>
            <p className="mt-1 text-xs leading-snug text-slate-400">
              {context.playlistName} — Auto find all searches every unresolved row. Apply safe matches only pre-fills
              high-confidence hits; review the rest manually.
            </p>
            <div
              className="mt-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-slate-800/90 bg-slate-900/50 px-3 py-2 font-mono text-[11px] text-slate-300"
              role="status"
              aria-live="polite"
            >
              <span>
                Missing <span className="font-semibold text-slate-100">{bulkSummary.missingTotal}</span>
              </span>
              <span className="text-slate-600" aria-hidden>
                ·
              </span>
              <span>
                Selected <span className="font-semibold text-[#1ed760]/95">{bulkSummary.selectedCount}</span>
              </span>
              <span className="text-slate-600" aria-hidden>
                ·
              </span>
              <span>
                Safe auto-ready{" "}
                <span className="font-semibold text-emerald-300/95">{bulkSummary.safeAutoReady}</span>
              </span>
              <span className="text-slate-600" aria-hidden>
                ·
              </span>
              <span>
                Needs review <span className="font-semibold text-amber-200/90">{bulkSummary.needsReview}</span>
              </span>
              <span className="text-slate-600" aria-hidden>
                ·
              </span>
              <span>
                Not found <span className="font-semibold text-rose-200/85">{bulkSummary.notFound}</span>
              </span>
              {bulkSummary.pendingSearch > 0 ? (
                <>
                  <span className="text-slate-600" aria-hidden>
                    ·
                  </span>
                  <span>
                    Pending search{" "}
                    <span className="font-semibold text-slate-200/90">{bulkSummary.pendingSearch}</span>
                  </span>
                </>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={bulkControlsDisabled}
                onClick={() => void handleAutoFindAll()}
                className="inline-flex rounded-lg border border-cyan-600/70 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-900/45 disabled:opacity-40"
              >
                {bulkFinding ? "Searching YouTube…" : "Auto find all"}
              </button>
              <button
                type="button"
                disabled={bulkControlsDisabled || bulkSummary.safeAutoReady === 0}
                onClick={() => void handleApplySafeMatches()}
                className="inline-flex rounded-lg border border-emerald-600/65 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-900/45 disabled:opacity-40"
                title={
                  bulkSummary.safeAutoReady === 0
                    ? "No high-confidence matches to apply (run Auto find all first, or search per row)"
                    : undefined
                }
              >
                {applySafeBusy ? "Applying…" : "Apply safe matches"}
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={bulkControlsDisabled}
            onClick={() => void onClose()}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 disabled:opacity-45"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          {applyError ? (
            <p className="mb-3 rounded-lg border border-rose-500/35 bg-rose-500/[0.08] px-3 py-2 text-xs text-rose-100/95">
              {applyError}
            </p>
          ) : null}
          <ul className="flex flex-col gap-6">
            {rows.map((row) => {
              const bundle = candidatesByOrder[row.playlistOrder];
              const cands = bundleDisplay(bundle);
              const primaryWasOfficialRanking = bundle?.primaryWasOfficialRanking ?? false;
              const showRecommendedOnFirst =
                cands.length > 0 &&
                (primaryWasOfficialRanking ||
                  scoreYoutubeCandidateForRow(row, cands[0]!, 0).tier !== "none");
              const attempted = searchAttemptedByOrder[row.playlistOrder] ?? false;
              const safe = cands.length > 0 && isSafeAutoPick(row, cands);
              const bestTier =
                cands.length > 0 ? classifyTopCandidates(row, cands).bestResult?.tier : undefined;
              const statusBadge =
                picksByOrder[row.playlistOrder]
                  ? { label: "Selected", cls: "border-[#1ed760]/50 text-[#1ed760]/95" }
                  : cands.length === 0 && !attempted
                    ? { label: "Not searched", cls: "border-slate-600 text-slate-500" }
                    : cands.length === 0
                      ? { label: "Not found", cls: "border-rose-500/40 text-rose-200/85" }
                      : safe
                        ? { label: "Safe match", cls: "border-emerald-500/45 text-emerald-200/90" }
                        : bestTier === "safe"
                          ? { label: "Ambiguous top 2", cls: "border-amber-500/45 text-amber-200/90" }
                          : bestTier === "review"
                            ? { label: "Review", cls: "border-amber-500/45 text-amber-200/90" }
                            : { label: "Uncertain", cls: "border-slate-600 text-slate-400" };

              return (
                <li key={`u-${row.playlistOrder}-${row.reason}`} className="rounded-xl border border-slate-800/90 bg-slate-900/40 p-3">
                  <div className="flex flex-wrap items-baseline gap-2 gap-y-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      #{row.playlistOrder + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-slate-100">{row.suggestedSearchQuery}</span>
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-400">
                      {row.reason.replace(/_/g, " ")}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge.cls}`}>
                      {statusBadge.label}
                    </span>
                  </div>
                  {row.displayTitle ? (
                    <p className="mt-1 text-xs text-slate-500">{row.displayTitle}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={Boolean(searchBusyByOrder[row.playlistOrder]) || bulkFinding}
                      onClick={() => void runSearchRow(row.playlistOrder, row.suggestedSearchQuery)}
                      className="inline-flex rounded-lg border border-cyan-700/65 bg-cyan-900/35 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-900/55 disabled:opacity-45"
                    >
                      {searchBusyByOrder[row.playlistOrder] ? "Searching YouTube…" : "Search YouTube"}
                    </button>
                    {picksByOrder[row.playlistOrder] ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPicksByOrder((prev) => {
                            const next = { ...prev };
                            delete next[row.playlistOrder];
                            return next;
                          })
                        }
                        className="inline-flex rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                      >
                        Clear pick
                      </button>
                    ) : null}
                  </div>
                  {typeof searchErrByOrder[row.playlistOrder] === "string" ? (
                    <p className="mt-2 text-xs text-rose-300/95">{searchErrByOrder[row.playlistOrder]}</p>
                  ) : null}

                  {cands.length > 0 ? (
                    <ul className="mt-3 flex flex-col gap-1">
                      {cands.map((c, idx) => {
                        const pick = picksByOrder[row.playlistOrder];
                        const candId = getYouTubeVideoId(c.url);
                        const picked =
                          Boolean(pick && candId && candId === getYouTubeVideoId(pick.url));
                        return (
                          <li key={`${row.playlistOrder}-${c.url}`}>
                            {idx === 1 && primaryWasOfficialRanking && cands.length > 1 ? (
                              <p className="mb-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                Alternatives
                              </p>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void selectCandidate(row.playlistOrder, c)}
                              className={`flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                                picked
                                  ? "border-[#1ed760]/55 bg-[#1ed760]/10 text-slate-50"
                                  : "border-slate-800 bg-slate-950/65 text-slate-200 hover:border-slate-700"
                              }`}
                            >
                              <span className="relative h-10 w-[4.25rem] shrink-0 overflow-hidden rounded bg-black/40">
                                {c.cover ? (
                                  <HydrationSafeImage src={c.cover} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <TrackMediaPlaceholder chip="YT" className="h-full w-full" showCornerBadge />
                                )}
                              </span>
                              <span className="min-w-0 flex-1 leading-snug">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-slate-100">{c.title}</span>
                                  {idx === 0 && showRecommendedOnFirst ? (
                                    <span className="shrink-0 rounded border border-[#1ed760]/45 bg-[#1ed760]/12 px-1.5 py-[1px] font-mono text-[8px] font-bold uppercase tracking-wider text-[#1ed760]/95">
                                      Recommended
                                    </span>
                                  ) : null}
                                </span>
                                {typeof c.durationSeconds === "number" ? (
                                  <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
                                    {formatDuration(c.durationSeconds)}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  {picksByOrder[row.playlistOrder] ? (
                    <p className="mt-2 text-[11px] text-[#1ed760]/90">
                      Selected: <span className="font-semibold">{picksByOrder[row.playlistOrder]!.title}</span>
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Pick a candidate — nothing is added until you hit “Add picks to playlist”.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/95 px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={bulkControlsDisabled}
            onClick={() => void onClose()}
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={countPicks === 0 || applyBusy || bulkFinding || applySafeBusy}
            title={countPicks === 0 ? "Choose at least one YouTube result" : undefined}
            onClick={() => void applyChoices()}
            className="rounded-lg bg-gradient-to-b from-[#1ed760] to-[#1db954] px-5 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(29,185,84,0.35)] hover:from-[#2ee770] hover:to-[#1ed760] disabled:opacity-40"
          >
            {applyBusy ? "Saving…" : `Add picks to playlist (${countPicks})`}
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
