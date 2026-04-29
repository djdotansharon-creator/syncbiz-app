import type { CatalogSourceFetchMethod, CatalogSourceFetchStatus } from "@prisma/client";

/** Serializable CatalogSourceSnapshot for JSON routes / admin UI props (ISO date strings). */
export type CatalogSourceSnapshotDTO = {
  id: string;
  catalogItemId: string;
  provider: string | null;
  sourceUrl: string;
  fetchedAt: string;
  fetchStatus: CatalogSourceFetchStatus;
  fetchMethod: CatalogSourceFetchMethod;
  title: string | null;
  description: string | null;
  hashtags: string[];
  sourceTags: string[];
  channelTitle: string | null;
  channelId: string | null;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  durationSec: number | null;
  thumbnail: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
