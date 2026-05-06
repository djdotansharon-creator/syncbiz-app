import type { LeafDisplayRefreshResponse } from "@/lib/library-leaf-display-refresh-types";

export type LeafDisplayMetaPatch = {
  viewCount?: number;
  likeCount?: number;
  publishedAt?: string;
  leafDurationSeconds?: number;
};

/** Fetch refreshed display fields for a leaf URL (YouTube: views/likes/duration/published when available). */
export async function fetchLeafDisplayMetadataRefresh(url: string): Promise<LeafDisplayMetaPatch | null> {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const res = await fetch("/api/library/leaf-display-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LeafDisplayRefreshResponse;
    const patch: LeafDisplayMetaPatch = {};
    if (typeof data.viewCount === "number" && Number.isFinite(data.viewCount)) patch.viewCount = data.viewCount;
    if (typeof data.likeCount === "number" && Number.isFinite(data.likeCount)) patch.likeCount = data.likeCount;
    if (typeof data.durationSeconds === "number" && Number.isFinite(data.durationSeconds)) {
      patch.leafDurationSeconds = data.durationSeconds;
    }
    if (typeof data.publishedAt === "string" && data.publishedAt.trim()) {
      patch.publishedAt = data.publishedAt.trim();
    }
    return Object.keys(patch).length > 0 ? patch : null;
  } catch {
    return null;
  }
}
