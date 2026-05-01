"use client";

import type { CatalogSourceSnapshotDTO } from "@/lib/catalog-source-snapshot-dto";

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function statusBadgeClasses(status: CatalogSourceSnapshotDTO["fetchStatus"]): string {
  switch (status) {
    case "SUCCESS":
      return "border-emerald-800/70 bg-emerald-950/45 text-emerald-100";
    case "PARTIAL":
      return "border-amber-800/70 bg-amber-950/35 text-amber-100";
    case "FAILED":
      return "border-rose-800/70 bg-rose-950/35 text-rose-100";
    default:
      return "border-neutral-700 bg-neutral-900 text-neutral-200";
  }
}

/** SUPER_ADMIN catalog tagging — Stage 5.9 append-only snapshot surface (never mutates curated CatalogItem fields). */
export function CatalogSourceMetadataPanel({
  catalogItemId: _catalogItemId,
  snapshot,
  unknownCues,
}: {
  catalogItemId: string;
  snapshot: CatalogSourceSnapshotDTO | null;
  unknownCues: readonly string[];
}) {
  return (
    <section className="rounded-lg border border-indigo-950/55 bg-gradient-to-b from-indigo-950/25 to-neutral-950/80 px-5 py-4 ring-1 ring-indigo-500/15">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300/95">
            Source metadata — extended (YouTube)
          </p>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-neutral-500">
            Extended snapshot fields — numeric summary and cues also appear in the <strong className="font-medium text-neutral-400">compact strip</strong> under the item header. Pull or replace snapshots using{" "}
            <strong className="font-medium text-neutral-400">Refresh source metadata</strong> there.
          </p>
        </div>
      </div>

      {!snapshot ? (
        <p className="mt-4 text-sm text-neutral-500">
          No snapshot yet — new YouTube items fetch in the background when first added to the catalog, or use refresh in the header (YouTube Data API first, yt-dlp fallback).
        </p>
      ) : (
        <div className="mt-4 space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${statusBadgeClasses(snapshot.fetchStatus)}`}
            >
              {snapshot.fetchStatus}
            </span>
            <span className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[11px] text-neutral-400">
              {snapshot.fetchMethod}
            </span>
            <span className="text-xs text-neutral-500">
              Last refreshed · <span className="tabular-nums text-neutral-300">{fmtIso(snapshot.fetchedAt)}</span>
            </span>
          </div>

          {snapshot.fetchStatus === "FAILED" && snapshot.errorMessage ? (
            <p className="rounded border border-rose-900/55 bg-rose-950/25 px-3 py-2 text-xs text-rose-100">
              {snapshot.errorMessage}
            </p>
          ) : null}

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Unknown / unmapped cues (taxonomy dictionary)
            </p>
            {unknownCues.length === 0 ? (
              <p className="mt-1 text-xs text-neutral-600">None listed — source cues mapped or empty.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {unknownCues.map((t) => (
                  <li
                    key={t}
                    className="rounded border border-amber-900/45 bg-amber-950/25 px-2 py-0.5 font-mono text-[11px] text-amber-100"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <details className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-[11px] text-neutral-500">
            <summary className="cursor-pointer font-medium text-neutral-400 hover:text-neutral-300">
              Full source tags &amp; hashtags (expand)
            </summary>
            <div className="mt-3 space-y-4 border-t border-neutral-800 pt-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Source tags</p>
                {snapshot.sourceTags.length === 0 ? (
                  <p className="mt-1 text-xs text-neutral-600">None reported.</p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {snapshot.sourceTags.map((t) => (
                      <li
                        key={t}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[11px] text-neutral-300"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Hashtags (description)</p>
                {snapshot.hashtags.length === 0 ? (
                  <p className="mt-1 text-xs text-neutral-600">None detected.</p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {snapshot.hashtags.map((t) => (
                      <li
                        key={t}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[11px] text-indigo-100/95"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </details>

          <details className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-[11px] text-neutral-500">
            <summary className="cursor-pointer font-medium text-neutral-400 hover:text-neutral-300">
              Snapshot title / description preview (read-only)
            </summary>
            <div className="mt-2 space-y-2 border-t border-neutral-800 pt-2">
              <p className="font-medium text-neutral-300">{snapshot.title ?? "—"}</p>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed text-neutral-400">
                {snapshot.description ?? "—"}
              </p>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
