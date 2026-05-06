import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { inferPlaylistType } from "@/lib/playlist-utils";
import { resolveYouTubeMetadata } from "@/lib/youtube-metadata-resolver";
import { fetchYouTubeCatalogSnapshotByYtDlp } from "@/lib/yt-dlp-search";
import type { LeafDisplayRefreshResponse } from "@/lib/library-leaf-display-refresh-types";

/**
 * Non-blocking display metadata refresh for leaf library URL cards (primarily YouTube).
 * Does not persist — clients merge into UI. Auth required.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const url = typeof (body as { url?: unknown })?.url === "string" ? (body as { url: string }).url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const type = inferPlaylistType(url);
  const out: LeafDisplayRefreshResponse = {};

  if (type !== "youtube") {
    return NextResponse.json(out);
  }

  try {
    const snap = await fetchYouTubeCatalogSnapshotByYtDlp(url);
    if (snap?.fields) {
      const f = snap.fields;
      if (f.viewCount != null) out.viewCount = f.viewCount;
      if (f.likeCount != null) out.likeCount = f.likeCount;
      if (f.durationSec != null) out.durationSeconds = f.durationSec;
      if (f.publishedAt instanceof Date && !Number.isNaN(f.publishedAt.getTime())) {
        out.publishedAt = f.publishedAt.toISOString();
      }
    }
  } catch {
    /* continue to lighter resolver */
  }

  if (out.viewCount == null || out.durationSeconds == null) {
    try {
      const meta = await resolveYouTubeMetadata(url, { forceRefresh: true });
      if (meta?.viewCount != null && out.viewCount == null) out.viewCount = meta.viewCount;
      if (meta?.durationSeconds != null && out.durationSeconds == null) out.durationSeconds = meta.durationSeconds;
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json(out);
}
