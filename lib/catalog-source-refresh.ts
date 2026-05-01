/**
 * Stage 5.9 — append-only CatalogSourceSnapshot rows (never overwrites CatalogItem curated fields).
 */
import "server-only";

import type { CatalogSourceSnapshot, Prisma } from "@prisma/client";
import type { CatalogTagSuggestion } from "@/lib/catalog-tagging-suggestions";
import type { CatalogSourceSnapshotDTO } from "@/lib/catalog-source-snapshot-dto";
import { computeMetadataTaxonomySuggestions } from "@/lib/catalog-metadata-taxonomy-suggestions";
import { prisma } from "@/lib/prisma";
import { getYouTubeVideoId } from "@/lib/playlist-utils";
import { fetchYouTubeCatalogSnapshotViaApi } from "@/lib/youtube-api-search";
import { fetchYouTubeCatalogSnapshotByYtDlp } from "@/lib/yt-dlp-search";
import { invalidateCache } from "@/lib/youtube-metadata-resolver";

function looksYouTubeCatalogItem(url: string, provider: string | null): boolean {
  if (/youtube\.com|youtu\.be/i.test(url)) return true;
  return (provider ?? "").toLowerCase().includes("youtube");
}

/** True when refreshCatalogSourceSnapshot can attempt YouTube API / yt-dlp for this row. */
export function shouldAttemptYouTubeCatalogSnapshot(item: {
  url: string;
  provider: string | null;
  videoId: string | null;
}): boolean {
  const vid = (item.videoId?.trim() || getYouTubeVideoId(item.url))?.trim();
  return Boolean(vid && looksYouTubeCatalogItem(item.url, item.provider));
}

function classifyApiSnapshot(
  fields: import("@/lib/youtube-api-search").YouTubeCatalogApiSnapshotFields,
): "SUCCESS" | "PARTIAL" {
  const hasTitle = Boolean(fields.title?.trim());
  const hasCore = fields.viewCount !== null && fields.durationSec !== null;
  return hasTitle && hasCore ? "SUCCESS" : "PARTIAL";
}

function classifyYtDlpSnapshot(
  fields: import("@/lib/yt-dlp-search").YouTubeCatalogYtDlpSnapshotFields,
): "SUCCESS" | "PARTIAL" {
  const hasTitle = Boolean(fields.title?.trim());
  const hasCore = fields.viewCount !== null && fields.durationSec !== null;
  return hasTitle && hasCore ? "SUCCESS" : "PARTIAL";
}

export async function refreshCatalogSourceSnapshot(
  catalogItemId: string,
): Promise<CatalogSourceSnapshot> {
  const item = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
  });
  if (!item) {
    throw new Error("Catalog item not found");
  }

  const catalogRow = item;

  const videoId = (catalogRow.videoId?.trim() || getYouTubeVideoId(catalogRow.url))?.trim() || null;

  async function appendFailed(message: string): Promise<CatalogSourceSnapshot> {
    return prisma.catalogSourceSnapshot.create({
      data: {
        catalogItemId,
        provider: catalogRow.provider,
        sourceUrl: catalogRow.url,
        fetchStatus: "FAILED",
        fetchMethod: "UNKNOWN",
        hashtags: [],
        sourceTags: [],
        errorMessage: message,
      },
    });
  }

  if (!looksYouTubeCatalogItem(catalogRow.url, catalogRow.provider) || !videoId) {
    return appendFailed(
      "YouTube-only refresh in V1 — URL must be a YouTube watch link with a resolvable video id.",
    );
  }

  const api = await fetchYouTubeCatalogSnapshotViaApi(videoId);
  if (api) {
    const fetchStatus = classifyApiSnapshot(api.fields);
    const row = await prisma.catalogSourceSnapshot.create({
      data: {
        catalogItemId,
        provider: catalogRow.provider ?? "youtube",
        sourceUrl: catalogRow.url,
        fetchStatus,
        fetchMethod: "YOUTUBE_API",
        title: api.fields.title,
        description: api.fields.description,
        hashtags: api.fields.hashtags,
        sourceTags: api.fields.sourceTags,
        channelTitle: api.fields.channelTitle,
        channelId: api.fields.channelId,
        publishedAt: api.fields.publishedAt,
        viewCount: api.fields.viewCount,
        likeCount: api.fields.likeCount,
        commentCount: api.fields.commentCount,
        durationSec: api.fields.durationSec,
        thumbnail: api.fields.thumbnail,
        rawJson: api.raw as Prisma.InputJsonValue,
      },
    });
    invalidateCache(catalogRow.url);
    return row;
  }

  const ytdlp = await fetchYouTubeCatalogSnapshotByYtDlp(catalogRow.url);
  if (ytdlp) {
    const fetchStatus = classifyYtDlpSnapshot(ytdlp.fields);
    const row = await prisma.catalogSourceSnapshot.create({
      data: {
        catalogItemId,
        provider: catalogRow.provider ?? "youtube",
        sourceUrl: catalogRow.url,
        fetchStatus,
        fetchMethod: "YTDLP",
        title: ytdlp.fields.title,
        description: ytdlp.fields.description,
        hashtags: ytdlp.fields.hashtags,
        sourceTags: ytdlp.fields.sourceTags,
        channelTitle: ytdlp.fields.channelTitle,
        channelId: ytdlp.fields.channelId,
        publishedAt: ytdlp.fields.publishedAt,
        viewCount: ytdlp.fields.viewCount,
        likeCount: ytdlp.fields.likeCount,
        commentCount: ytdlp.fields.commentCount,
        durationSec: ytdlp.fields.durationSec,
        thumbnail: ytdlp.fields.thumbnail,
        rawJson: ytdlp.raw as Prisma.InputJsonValue,
      },
    });
    invalidateCache(catalogRow.url);
    return row;
  }

  return appendFailed(
    "YouTube Data API did not return data (missing key / quota / network) and yt-dlp produced no usable metadata.",
  );
}

export async function loadSourceMetadataSuggestionsForSnapshot(
  catalogItemId: string,
  snapshot: CatalogSourceSnapshot,
): Promise<{ metadataSuggestions: CatalogTagSuggestion[]; unknownCues: string[] }> {
  const hasText =
    Boolean(snapshot.title?.trim()) ||
    Boolean(snapshot.description?.trim()) ||
    snapshot.hashtags.length > 0 ||
    snapshot.sourceTags.length > 0;

  if (!hasText || snapshot.fetchStatus === "FAILED") {
    return { metadataSuggestions: [], unknownCues: [] };
  }

  const [dictionaryRows, assignedRows] = await Promise.all([
    prisma.musicTaxonomyTag.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, slug: true, labelEn: true, labelHe: true, aliases: true },
    }),
    prisma.catalogItemTaxonomyTag.findMany({
      where: { catalogItemId },
      select: { taxonomyTagId: true },
    }),
  ]);
  const assignedIds = new Set(assignedRows.map((r) => r.taxonomyTagId));

  const meta = computeMetadataTaxonomySuggestions({
    dictionary: dictionaryRows.map((t) => ({
      id: t.id,
      slug: t.slug,
      labelEn: t.labelEn,
      labelHe: t.labelHe,
      aliases: t.aliases ?? [],
    })),
    assignedIds,
    title: snapshot.title,
    description: snapshot.description,
    hashtags: snapshot.hashtags,
    sourceTags: snapshot.sourceTags,
  });

  return {
    metadataSuggestions: meta.suggestions,
    unknownCues: meta.unknownCues,
  };
}

/**
 * Enqueue a non-blocking YouTube provider snapshot fetch for this catalog row (normal intake path).
 * Skips non-YouTube / missing video id; skips when latest snapshot is SUCCESS or PARTIAL (no duplicate auto-refresh).
 * Retries FAILED snapshots after a cooldown. Manual admin refresh always appends a new snapshot.
 */
export function scheduleCatalogSnapshotIntakeIfNeeded(catalogItemId: string): void {
  void runCatalogSnapshotIntakeIfNeeded(catalogItemId);
}

/** Failed snapshot auto-retry cooldown — avoids hammering API when keys/quota are down. */
const SNAPSHOT_FAILED_RETRY_COOLDOWN_MS = 3 * 60 * 1000;

async function runCatalogSnapshotIntakeIfNeeded(catalogItemId: string): Promise<void> {
  try {
    const item = await prisma.catalogItem.findUnique({
      where: { id: catalogItemId },
      select: { url: true, provider: true, videoId: true },
    });
    if (!item) return;
    if (!shouldAttemptYouTubeCatalogSnapshot(item)) return;

    const latest = await prisma.catalogSourceSnapshot.findFirst({
      where: { catalogItemId },
      orderBy: { fetchedAt: "desc" },
      select: { fetchStatus: true, fetchedAt: true },
    });

    if (latest?.fetchStatus === "SUCCESS" || latest?.fetchStatus === "PARTIAL") {
      return;
    }

    if (latest?.fetchStatus === "FAILED") {
      const age = Date.now() - latest.fetchedAt.getTime();
      if (age < SNAPSHOT_FAILED_RETRY_COOLDOWN_MS) return;
    }

    await refreshCatalogSourceSnapshot(catalogItemId);
  } catch (e) {
    console.warn("[catalog snapshot intake]", catalogItemId, e);
  }
}

/** Serialize snapshot for JSON responses / client props (ISO date strings). */
export function serializeCatalogSourceSnapshot(row: CatalogSourceSnapshot): CatalogSourceSnapshotDTO {
  return {
    id: row.id,
    catalogItemId: row.catalogItemId,
    provider: row.provider,
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt.toISOString(),
    fetchStatus: row.fetchStatus,
    fetchMethod: row.fetchMethod,
    title: row.title,
    description: row.description,
    hashtags: row.hashtags,
    sourceTags: row.sourceTags,
    channelTitle: row.channelTitle,
    channelId: row.channelId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    durationSec: row.durationSec,
    thumbnail: row.thumbnail,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

