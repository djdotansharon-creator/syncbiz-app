/** Shared shape for POST /api/library/leaf-display-refresh JSON body. */
export type LeafDisplayRefreshResponse = {
  viewCount?: number;
  likeCount?: number;
  durationSeconds?: number;
  publishedAt?: string;
};
