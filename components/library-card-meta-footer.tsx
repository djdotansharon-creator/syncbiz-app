"use client";

import type { ReactNode } from "react";
import { formatDuration, formatDurationClock, formatPublishedMonthYearCompact, formatSyncBizCurationChip, formatViewCount } from "@/lib/format-utils";
import {
  libraryCardEffectiveCuration,
  libraryCardEffectiveLikeCount,
  libraryCardEffectivePublishedAt,
  libraryCardEffectiveViewCount,
  type UnifiedSource,
} from "@/lib/source-types";
import { getLibraryListContainerMetaStripModel } from "@/lib/library-list-container-display";

function MetaSep() {
  return <span className="library-card-meta-sep" aria-hidden>·</span>;
}

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
  const effectiveLikes = libraryCardEffectiveLikeCount(source);
  const publishedAtRaw = libraryCardEffectivePublishedAt(source);
  const durationSec = source.leafDurationSeconds ?? source.playlist?.durationSeconds ?? 0;

  const showViews = effectiveViews != null && Number.isFinite(effectiveViews);
  const showLikes = effectiveLikes != null && Number.isFinite(effectiveLikes);
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

  if (!showViews && !showLikes && !showDuration && !pubVal && !showSync && !showDesktopOnly) {
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
        {formatViewCount(effectiveViews!)} views
      </span>,
    );
  }
  if (showLikes) {
    items.push(
      <span key="likes" className="library-card-meta-item" title="Likes">
        {formatViewCount(effectiveLikes!)} likes
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
      {m.trackCount === 1 ? "1 track" : `${m.trackCount} tracks`}
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
        {formatViewCount(m.viewsN)} views
      </span>,
    );
  }
  if (m.showLikes) {
    items.push(
      <span key="likes" className="library-card-meta-item" title="Likes">
        {formatViewCount(m.likesN)} likes
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
