import { NextResponse } from "next/server";
import { resolveStreamerApk, streamerReleasesPageUrl } from "@/lib/streamer-apk-resolve";

/**
 * Same-origin controlled download for the VONO Streamer APK. 302-redirects to the
 * resolved signed asset (env override or latest `streamer-v*` GitHub Release).
 * Keeps the customer-facing URL on our domain; if no build exists yet, sends the
 * user to the Releases page rather than dead-ending.
 */
export async function GET() {
  const apk = await resolveStreamerApk();
  if (apk) {
    return NextResponse.redirect(apk.url, 302);
  }
  return NextResponse.redirect(streamerReleasesPageUrl(), 302);
}
