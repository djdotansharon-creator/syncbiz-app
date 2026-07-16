"use client";

import type { ReactNode } from "react";
import { formatDuration, formatDurationClock, formatPublishedMonthYearCompact, formatSyncBizCurationChip, formatViewCount } from "@/lib/format-utils";
import {
  libraryCardEffectiveCuration,

  libraryCardEffectivePublishedAt,
  libraryCardEffectiveViewCount,
  type UnifiedSource,
} from "@/lib/source-types";
import { getLibraryListContainerMetaStripModel } from "@/lib/library-list-container-display";

function MetaSep() {
  return <span className="library-card-meta-sep" aria-hidden>·</span>;
}

/* Tiny stroke glyphs — stats read as icon+number, not words (quieter card). */
function MetaGlyph({ d, filled = false }: { d: string; filled?: boolean }) {
  return (
    <svg
      className="library-card-meta-glyph"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const GLYPH_NOTE = "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";
const GLYPH_EYE = "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z";

function CompactMetaFooter({ children }: { children: ReactNode }) {
  return (
    <div
      className="library-card-meta-footer"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="group"
    >
      {children}
    </div>
  );
}

/** Compact stats strip for SINGLE / SET / LOCAL leaf cards. */
export function LibraryCardLeafMetaFooter({
  source,
  showDesktopOnly = false,
}: {
  source: UnifiedSource;
  showDesktopOnly?: boolean;
}) {
  const effectiveViews = libraryCardEffectiveViewCount(source);

  const publishedAtRaw = libraryCardEffectivePublishedAt(source);
  const durationSec = source.leafDurationSeconds ?? source.playlist?.durationSeconds ?? 0;

  const showViews = effectiveViews != null && Number.isFinite(effectiveViews);

  const showDuration = durationSec > 0;

  let pubVal = "";
  if (publishedAtRaw) {
    const compact = formatPublishedMonthYearCompact(publishedAtRaw);
    if (compact) pubVal = compact;
  }

  const curation = libraryCardEffectiveCuration(source);
  const syncLabel =
    curation != null && Number.isFinite(curation) && curation > 0 ? formatSyncBizCurationChip(curation) : "";
  const showSync = syncLabel !== "" && syncLabel !== "—";

  if (!showViews && !showDuration && !pubVal && !showSync && !showDesktopOnly) {
    return null;
  }

  const items: ReactNode[] = [];

  if (showDesktopOnly) {
    items.push(
      <span key="desktop" className="library-card-meta-item library-card-meta-item--desktop" title="Requires SyncBiz desktop app">
        Desktop only
      </span>,
    );
  }

  if (showViews) {
    items.push(
      <span key="views" className="library-card-meta-item" title="Views">
        <MetaGlyph d={GLYPH_EYE} />
        {formatViewCount(effectiveViews!)}
      </span>,
    );
  }
  if (showDuration) {
    items.push(
      <span key="dur" className="library-card-meta-item library-card-meta-item--duration" title="Duration">
        {formatDurationClock(durationSec)}
      </span>,
    );
  }
  if (pubVal) {
    items.push(
      <span key="date" className="library-card-meta-item" title="Published">
        {pubVal}
      </span>,
    );
  }
  if (showSync) {
    items.push(
      <span key="sync" className="library-card-meta-item library-card-meta-item--sync" title="SyncBiz curation">
        {syncLabel}
      </span>,
    );
  }

  return (
    <CompactMetaFooter>
      {items.map((item, i) => (
        <span key={i} className="contents">
          {i > 0 ? <MetaSep /> : null}
          {item}
        </span>
      ))}
    </CompactMetaFooter>
  );
}

/** Compact footer for PLAYLIST containers — track count + optional stats. */
export function LibraryCardPlaylistMetaFooter({ source }: { source: UnifiedSource }) {
  const m = getLibraryListContainerMetaStripModel(source);
  if (!m) return null;

  const items: ReactNode[] = [
    <span key="tracks" className="library-card-meta-item library-card-meta-item--tracks" title={m.itemTitle}>
      <MetaGlyph d={GLYPH_NOTE} />
      {m.trackCount}
    </span>,
  ];

  if (m.showDuration) {
    items.push(
      <span key="dur" className="library-card-meta-item library-card-meta-item--duration" title="Total duration">
        {formatDuration(m.totalSec)}
      </span>,
    );
  }
  if (m.showViews) {
    items.push(
      <span key="views" className="library-card-meta-item" title="Views">
        <MetaGlyph d={GLYPH_EYE} />
        {formatViewCount(m.viewsN)}
      </span>,
    );
  }
  if (m.dateRaw) {
    items.push(
      <span key="date" className="library-card-meta-item" title="Published or added">
        {m.dateRaw}
      </span>,
    );
  }
  if (m.showSync) {
    items.push(
      <span key="sync" className="library-card-meta-item library-card-meta-item--sync" title="SyncBiz curation">
        {m.syncLabel}
      </span>,
    );
  }

  return (
    <CompactMetaFooter>
      {items.map((item, i) => (
        <span key={i} className="contents">
          {i > 0 ? <MetaSep /> : null}
          {item}
        </span>
      ))}
    </CompactMetaFooter>
  );
}
