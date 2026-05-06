"use client";

import { formatViewCount, formatDuration, formatPublishedMonthYearCompact, formatSyncBizCurationChip } from "@/lib/format-utils";
import { getLibraryListContainerMetaStripModel } from "@/lib/library-list-container-display";
import { resolveLibraryKindBadge } from "@/lib/library-display-classification";
import {
  libraryCardEffectiveCuration,
  libraryCardEffectiveLikeCount,
  libraryCardEffectivePublishedAt,
  libraryCardEffectiveViewCount,
  type UnifiedSource,
} from "@/lib/source-types";

function ListStackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeartOutlineIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** True when list row should use `LibraryLeafListMetadataStrip` instead of legacy genre line. */
export function shouldRenderLibraryLeafListMetadataStrip(source: UnifiedSource): boolean {
  const kind = resolveLibraryKindBadge(source);
  if (kind === "LIST" || kind === "RADIO") return false;

  const durationSec = source.leafDurationSeconds ?? source.playlist?.durationSeconds ?? 0;
  if (durationSec > 0) return true;

  const viewsRaw = libraryCardEffectiveViewCount(source);
  if (viewsRaw != null && Number.isFinite(viewsRaw)) return true;

  const likesRaw = libraryCardEffectiveLikeCount(source);
  if (likesRaw != null && Number.isFinite(likesRaw)) return true;

  const publishedAtRaw = libraryCardEffectivePublishedAt(source);
  if (publishedAtRaw && formatPublishedMonthYearCompact(publishedAtRaw)) return true;

  const curation = libraryCardEffectiveCuration(source);
  const syncLabel =
    curation != null && Number.isFinite(curation) && curation > 0 ? formatSyncBizCurationChip(curation) : "";
  if (syncLabel !== "" && syncLabel !== "—") return true;

  return false;
}

/**
 * LIST-style stats row for URL leaves (SINGLE/SET) in library **list** rows — matches container strip
 * order/icons so playlist drill-down matches All Library.
 */
export function LibraryLeafListMetadataStrip({ source }: { source: UnifiedSource }) {
  const kind = resolveLibraryKindBadge(source);
  if (kind === "LIST" || kind === "RADIO") return null;

  const durationSec = source.leafDurationSeconds ?? source.playlist?.durationSeconds ?? 0;
  const showDuration = durationSec > 0;

  const viewsRaw = libraryCardEffectiveViewCount(source);
  const showViews = viewsRaw != null && Number.isFinite(viewsRaw);

  const likesRaw = libraryCardEffectiveLikeCount(source);
  const showLikes = likesRaw != null && Number.isFinite(likesRaw);

  const publishedAtRaw = libraryCardEffectivePublishedAt(source);
  let dateRaw = "";
  if (publishedAtRaw) {
    const c = formatPublishedMonthYearCompact(publishedAtRaw);
    if (c) dateRaw = c;
  }

  const curation = libraryCardEffectiveCuration(source);
  const syncLabel =
    curation != null && Number.isFinite(curation) && curation > 0 ? formatSyncBizCurationChip(curation) : "";
  const showSync = syncLabel !== "" && syncLabel !== "—";

  if (!shouldRenderLibraryLeafListMetadataStrip(source)) return null;

  const iconClass = "h-3.5 w-3.5 shrink-0 text-cyan-400/70";
  const valClass = "text-[12px] font-semibold tabular-nums tracking-tight text-slate-100";

  return (
    <div
      className="library-list-meta-strip flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-cyan-500/15 pt-2.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="group"
      aria-label="Track stats"
    >
      <span className="inline-flex items-center gap-1.5" title="Items in this library row">
        <ListStackIcon className={iconClass} />
        <span className={valClass}>
          1<span className="ml-0.5 text-[11px] font-medium text-slate-400">item</span>
        </span>
      </span>

      {showDuration ? (
        <span className="inline-flex items-center gap-1.5" title="Duration">
          <ClockIcon className={iconClass} />
          <span className={valClass}>{formatDuration(durationSec)}</span>
        </span>
      ) : null}

      {showViews ? (
        <span className="inline-flex items-center gap-1.5" title="Views">
          <EyeIcon className={iconClass} />
          <span className={valClass}>{formatViewCount(viewsRaw!)}</span>
        </span>
      ) : null}

      {showLikes ? (
        <span className="inline-flex items-center gap-1.5" title="Likes">
          <HeartOutlineIcon className={`${iconClass} text-slate-400`} />
          <span className={valClass}>{formatViewCount(likesRaw!)}</span>
        </span>
      ) : null}

      {dateRaw ? (
        <span className="inline-flex items-center gap-1.5" title="Published">
          <span className={`${valClass} text-[11px] font-semibold uppercase tracking-wide text-slate-300`}>{dateRaw}</span>
        </span>
      ) : null}

      {showSync ? (
        <span
          className="inline-flex items-center rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200/95"
          title="SyncBiz curation"
        >
          {syncLabel}
        </span>
      ) : null}
    </div>
  );
}

/** Icon-first summary row for LIST playlist containers (grid cards + list rows). */
export function ListContainerMetadataStrip({ source }: { source: UnifiedSource }) {
  const m = getLibraryListContainerMetaStripModel(source);
  if (!m) return null;

  const iconClass = "h-3.5 w-3.5 shrink-0 text-cyan-400/70";
  const valClass = "text-[12px] font-semibold tabular-nums tracking-tight text-slate-100";

  return (
    <div
      className="library-list-meta-strip flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-cyan-500/15 pt-2.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="group"
      aria-label="Playlist summary"
    >
      <span className="inline-flex items-center gap-1.5" title={m.itemTitle}>
        <ListStackIcon className={iconClass} />
        <span className={valClass}>
          {m.trackCount === 1 ? "1" : String(m.trackCount)}
          <span className="ml-0.5 text-[11px] font-medium text-slate-400">{m.trackCount === 1 ? "item" : "items"}</span>
        </span>
      </span>

      {m.showDuration ? (
        <span className="inline-flex items-center gap-1.5" title="Total duration">
          <ClockIcon className={iconClass} />
          <span className={valClass}>{formatDuration(m.totalSec)}</span>
        </span>
      ) : null}

      {m.showViews ? (
        <span className="inline-flex items-center gap-1.5" title="Views">
          <EyeIcon className={iconClass} />
          <span className={valClass}>{formatViewCount(m.viewsN)}</span>
        </span>
      ) : null}

      {m.showLikes ? (
        <span className="inline-flex items-center gap-1.5" title="Likes">
          <HeartOutlineIcon className={`${iconClass} text-slate-400`} />
          <span className={valClass}>{formatViewCount(m.likesN)}</span>
        </span>
      ) : null}

      {m.dateRaw ? (
        <span className="inline-flex items-center gap-1.5" title="Published or added">
          <span className={`${valClass} text-[11px] font-semibold uppercase tracking-wide text-slate-300`}>{m.dateRaw}</span>
        </span>
      ) : null}

      {m.showSync ? (
        <span
          className="inline-flex items-center rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200/95"
          title="SyncBiz curation"
        >
          {m.syncLabel}
        </span>
      ) : null}
    </div>
  );
}
