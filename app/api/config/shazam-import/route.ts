import { NextResponse } from "next/server";
import { isShazamImportEnabled } from "@/lib/shazam-import-flag";

// Reads a server-only env flag; keep on the Node runtime.
export const runtime = "nodejs";

/**
 * Surfaces the server-only `SYNCBIZ_SHAZAM_IMPORT_ENABLED` flag to the (all
 * client-side) mobile tree. Not sensitive — a plain UI toggle. The mobile
 * Shazam entry point stays hidden until this returns `{ enabled: true }`.
 */
export async function GET() {
  return NextResponse.json({ enabled: isShazamImportEnabled() });
}
