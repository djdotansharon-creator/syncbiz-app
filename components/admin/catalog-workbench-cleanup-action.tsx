"use client";

/**
 * Safe cleanup affordance — mirrors server usage gates; no destructive/archive API in V1.
 */
export function CatalogWorkbenchCleanupAction({
  strictlyUnused,
  blockParts,
  usageSummaryLine,
}: {
  catalogItemId: string;
  strictlyUnused: boolean;
  blockParts: readonly string[];
  /** One-line counts when item is in use (playlists / workspaces / schedules / plays). */
  usageSummaryLine: string | null;
}) {
  const blockedDetail =
    blockParts.length > 0
      ? blockParts.join("; ")
      : "This catalog row still has customer or playback references.";

  const blockedTitle = strictlyUnused
    ? undefined
    : `Hard delete / remove row: blocked — ${blockedDetail}. Removing the CatalogItem would break FK-linked playlists or usage history.`;

  return (
    <div className="flex min-w-[220px] max-w-[min(100%,20rem)] flex-col gap-2 rounded-lg border border-neutral-700 bg-neutral-950/55 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Catalog cleanup</p>

      {strictlyUnused ? (
        <>
          <div className="flex flex-wrap gap-2">
            <span className="rounded border border-neutral-600 bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold uppercase text-neutral-400">
              Unused
            </span>
            <span className="rounded border border-amber-900/55 bg-amber-950/35 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
              Candidate for cleanup
            </span>
          </div>
          <p className="text-[11px] leading-snug text-neutral-400">
            <strong className="font-medium text-neutral-300">Archive / remove from catalog:</strong> no safe backend yet — needs an{" "}
            <code className="font-mono text-[10px] text-neutral-500">archived</code> /{" "}
            <code className="font-mono text-[10px] text-neutral-500">withdrawnFromCatalog</code>-style flag plus an admin route that refuses while FK usage exists.
          </p>
          <p className="text-[11px] font-medium text-emerald-200/95">Hard-delete only via future explicit API after usage checks.</p>
        </>
      ) : (
        <>
          <p className="text-[11px] leading-snug text-amber-100/90">
            <strong className="font-medium text-neutral-200">In use — row removal blocked.</strong> Playlists, schedules, and analytics references must stay valid.
          </p>
          {usageSummaryLine ? (
            <p className="text-[11px] leading-snug text-neutral-400">{usageSummaryLine}</p>
          ) : null}
          <p className="text-[10px] leading-relaxed text-neutral-600">Detail: {blockedDetail}</p>
          <p className="text-[11px] leading-snug text-neutral-500">
            <strong className="font-medium text-neutral-400">Hide / exclude from future discovery:</strong> not implemented — would need a non-destructive catalog flag and recommendation/search filters that skip hidden rows without breaking existing playlist{" "}
            <code className="font-mono text-[10px] text-neutral-600">catalogId</code> links (no migration in this task).
          </p>
        </>
      )}

      <button
        type="button"
        disabled
        title={
          strictlyUnused
            ? "Planned: archive unused CatalogItem after schema + admin route ship."
            : blockedTitle
        }
        className={`rounded border px-3 py-2 text-center text-xs font-semibold transition-colors ${
          strictlyUnused
            ? "cursor-not-allowed border-emerald-800/50 bg-emerald-950/25 text-emerald-100/85 opacity-80"
            : "cursor-not-allowed border-neutral-600 bg-neutral-900 text-neutral-500 opacity-70"
        }`}
      >
        Archive / remove row (planned)
      </button>

      <p className="text-[10px] leading-snug text-neutral-600">
        Never hard-delete a referenced CatalogItem from this screen. Archive/hide are future-safe patterns only.
      </p>
    </div>
  );
}
