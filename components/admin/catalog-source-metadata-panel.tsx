"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { CatalogSourceSnapshotDTO } from "@/lib/catalog-source-snapshot-dto";

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
  catalogItemId,
  snapshot,
  unknownCues,
}: {
  catalogItemId: string;
  snapshot: CatalogSourceSnapshotDTO | null;
  unknownCues: readonly string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      const res = await fetch(
        `/api/admin/platform/catalog-items/${catalogItemId}/source-metadata/refresh`,
        {
          method: "POST",
          credentials: "same-origin",
        },
      );
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(typeof j.error === "string" ? j.error : `Refresh failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }, [catalogItemId, router]);

  return (
    <section className="rounded-lg border border-indigo-950/55 bg-gradient-to-b from-indigo-950/25 to-neutral-950/80 px-5 py-4 ring-1 ring-indigo-500/15">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300/95">
            Source metadata (YouTube)
          </p>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-neutral-500">
            Refresh pulls provider metadata into an append-only snapshot row. Catalog title/thumbnail/duration/genres here stay unchanged —
            use suggestions below as hints only (pending → save).
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="shrink-0 rounded border border-indigo-700 bg-indigo-950/55 px-3 py-2 text-xs font-semibold text-indigo-50 hover:bg-indigo-900/65 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? "Refreshing…" : "Refresh source metadata"}
        </button>
      </div>

      {localErr ? (
        <p className="mt-3 rounded border border-rose-900/70 bg-rose-950/35 px-3 py-2 text-xs text-rose-100">{localErr}</p>
      ) : null}

      {!snapshot ? (
        <p className="mt-4 text-sm text-neutral-500">No snapshot yet — press refresh (YouTube Data API first, yt-dlp fallback).</p>
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

          {snapshot.thumbnail?.trim() ? (
            <div className="flex flex-wrap items-start gap-3">
              <div className="shrink-0 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900">
                {/* eslint-disable-next-line @next/next/no-img-element -- external provider URL; SUPER_ADMIN catalog tooling */}
                <img
                  src={snapshot.thumbnail.trim()}
                  alt=""
                  className="h-[72px] w-[128px] object-cover"
                  loading="lazy"
                />
              </div>
              <p className="pt-0.5 text-[10px] text-neutral-600">Provider snapshot preview — not the curated catalog thumbnail.</p>
            </div>
          ) : null}

          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-neutral-500">Views</dt>
              <dd className="tabular-nums font-medium text-neutral-100">{fmtNum(snapshot.viewCount)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Likes</dt>
              <dd className="tabular-nums font-medium text-neutral-100">{fmtNum(snapshot.likeCount)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Comments</dt>
              <dd className="tabular-nums font-medium text-neutral-100">{fmtNum(snapshot.commentCount)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Duration (snapshot)</dt>
              <dd className="font-medium text-neutral-100">{fmtDuration(snapshot.durationSec)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-neutral-500">Published</dt>
              <dd className="font-medium text-neutral-200">{fmtIso(snapshot.publishedAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-neutral-500">Channel</dt>
              <dd className="text-neutral-200">
                {snapshot.channelTitle ?? "—"}
                {snapshot.channelId ? (
                  <span className="ml-2 font-mono text-[11px] text-neutral-500">{snapshot.channelId}</span>
                ) : null}
              </dd>
            </div>
          </dl>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Source tags</p>
            {snapshot.sourceTags.length === 0 ? (
              <p className="mt-1 text-xs text-neutral-600">None reported.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {snapshot.sourceTags.slice(0, 40).map((t) => (
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
