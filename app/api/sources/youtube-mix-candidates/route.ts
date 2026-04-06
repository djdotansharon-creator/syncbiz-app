import { NextRequest, NextResponse } from "next/server";
import { isYouTubeMultiTrackUrl } from "@/lib/playlist-utils";
import {
  enumerateYouTubeMixPlaylistCandidates,
  YOUTUBE_MIX_IMPORT_CANDIDATE_LIMIT,
} from "@/lib/yt-dlp-search";

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isYouTubeHost(url: string): boolean {
  const h = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return "";
    }
  })();
  return h === "youtube.com" || h === "youtu.be" || h === "m.youtube.com";
}

/**
 * POST body: `{ url: string }` — YouTube multi-track URL (mix, radio, playlist).
 * Response: `{ candidates: YouTubeMixImportCandidate[], error?: string }`
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string };
    const raw = typeof body.url === "string" ? body.url.trim() : "";
    if (!raw || !isValidHttpUrl(raw)) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    if (!isYouTubeHost(raw)) {
      return NextResponse.json({ error: "Only YouTube URLs are supported" }, { status: 400 });
    }
    if (!isYouTubeMultiTrackUrl(raw)) {
      return NextResponse.json(
        { error: "URL is not a multi-track YouTube source" },
        { status: 400 },
      );
    }

    const result = await enumerateYouTubeMixPlaylistCandidates(raw, YOUTUBE_MIX_IMPORT_CANDIDATE_LIMIT);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.warn("[youtube-mix-candidates]", e);
    return NextResponse.json(
      {
        candidates: [],
        error: "Could not load tracks.",
      },
      { status: 200 },
    );
  }
}
