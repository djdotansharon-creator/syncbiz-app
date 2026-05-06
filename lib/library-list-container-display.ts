import { formatPublishedMonthYearCompact, formatSyncBizCurationChip } from "@/lib/format-utils";
import { libraryListContainerMeta, resolveLibraryKindBadge } from "@/lib/library-display-classification";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { libraryCardEffectiveCuration, type UnifiedSource } from "@/lib/source-types";

/**
 * LIST container views: prefer playlist-level `viewCount` when set; otherwise sum positive child `viewCount` values.
 */
export function libraryListContainerViewCount(source: UnifiedSource): number | undefined {
  const p = source.playlist;
  if (!p) return undefined;
  if (typeof p.viewCount === "number" && Number.isFinite(p.viewCount) && p.viewCount > 0) {
    return p.viewCount;
  }
  const tracks = getPlaylistTracks(p);
  let sum = 0;
  for (const t of tracks) {
    if (typeof t.viewCount === "number" && Number.isFinite(t.viewCount) && t.viewCount > 0) {
      sum += t.viewCount;
    }
  }
  return sum > 0 ? sum : undefined;
}

/**
 * LIST container likes: prefer playlist-level `likeCount` when set; otherwise sum positive child `likeCount` values.
 */
export function libraryListContainerLikeCount(source: UnifiedSource): number | undefined {
  const p = source.playlist;
  if (!p) return undefined;
  if (typeof p.likeCount === "number" && Number.isFinite(p.likeCount) && p.likeCount > 0) {
    return p.likeCount;
  }
  const tracks = getPlaylistTracks(p);
  let sum = 0;
  for (const t of tracks) {
    if (typeof t.likeCount === "number" && Number.isFinite(t.likeCount) && t.likeCount > 0) {
      sum += t.likeCount;
    }
  }
  return sum > 0 ? sum : undefined;
}

/** Compact published/created month+year for LIST container when available. */
export function libraryListContainerDateCompact(source: UnifiedSource): string | undefined {
  const p = source.playlist;
  if (!p) return undefined;
  const pub = typeof p.publishedAt === "string" && p.publishedAt.trim() ? p.publishedAt.trim() : "";
  if (pub) {
    const c = formatPublishedMonthYearCompact(pub);
    if (c) return c;
  }
  const created = typeof p.createdAt === "string" && p.createdAt.trim() ? p.createdAt.trim() : "";
  if (created) {
    const c = formatPublishedMonthYearCompact(created);
    if (c) return c;
  }
  return undefined;
}

export type LibraryListContainerMetaStripModel = {
  trackCount: number;
  itemTitle: string;
  showDuration: boolean;
  totalSec: number;
  showViews: boolean;
  viewsN: number;
  showLikes: boolean;
  likesN: number;
  dateRaw: string;
  showSync: boolean;
  syncLabel: string;
};

/** Compute LIST strip payload, or `null` when nothing should render (branch tile can fall back to meta line). */
export function getLibraryListContainerMetaStripModel(source: UnifiedSource): LibraryListContainerMetaStripModel | null {
  if (resolveLibraryKindBadge(source) !== "LIST" || !source.playlist) return null;

  const listMeta = libraryListContainerMeta(source);
  const viewsRaw = libraryListContainerViewCount(source);
  const showViews = viewsRaw != null && Number.isFinite(viewsRaw);
  const likesRaw = libraryListContainerLikeCount(source);
  const showLikes = likesRaw != null && Number.isFinite(likesRaw);
  const totalSec = listMeta.durationSecondsTotal;
  const showDuration = typeof totalSec === "number" && totalSec > 0;
  const dateRaw = libraryListContainerDateCompact(source) ?? "";

  const curation = libraryCardEffectiveCuration(source);
  const syncLabel =
    curation != null && Number.isFinite(curation) && curation > 0 ? formatSyncBizCurationChip(curation) : "";
  const showSync = syncLabel !== "" && syncLabel !== "—";

  const hasMetaFields = showDuration || showViews || showLikes || Boolean(dateRaw) || showSync;
  if (!hasMetaFields && listMeta.trackCount === 0) return null;

  const itemTitle = listMeta.trackCount === 1 ? "1 item" : `${listMeta.trackCount} items`;

  return {
    trackCount: listMeta.trackCount,
    itemTitle,
    showDuration,
    totalSec: typeof totalSec === "number" ? totalSec : 0,
    showViews,
    viewsN: viewsRaw ?? 0,
    showLikes,
    likesN: likesRaw ?? 0,
    dateRaw,
    showSync,
    syncLabel,
  };
}
