import { NextResponse } from "next/server";
import { resolveStreamerApk, streamerReleasesPageUrl } from "@/lib/streamer-apk-resolve";

/**
 * JSON status for the VONO Streamer Android TV APK, used by the in-app Downloads
 * page. When a build is available, `url` is a SAME-ORIGIN download link
 * (`/api/streamer/apk/download`) so the browser download is controlled by us;
 * `directUrl` is the underlying asset for reference. When nothing is published
 * yet, `ok:false` + `releasesPageUrl` drive an honest "coming soon" state.
 */
export async function GET() {
  const releasesPageUrl = streamerReleasesPageUrl();
  const apk = await resolveStreamerApk();

  if (!apk) {
    return NextResponse.json({
      ok: false,
      url: null,
      releasesPageUrl,
      error: "STREAMER_APK_NOT_PUBLISHED",
    });
  }

  return NextResponse.json({
    ok: true,
    url: "/api/streamer/apk/download",
    directUrl: apk.url,
    fileName: apk.fileName,
    version: apk.version,
    sizeBytes: apk.sizeBytes,
    releasedAt: apk.publishedAt,
    releasesPageUrl,
    source: apk.source,
  });
}
