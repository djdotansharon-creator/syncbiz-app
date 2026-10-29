import { NextResponse } from "next/server";
import { isJoinEnvEnabled } from "@/lib/join-by-code";

/** Public: is "join a business by code" on? Reads the env flag only — no database, so it is safe before any migration. */
export async function GET() {
  return NextResponse.json({ enabled: isJoinEnvEnabled() }, { headers: { "Cache-Control": "no-store" } });
}
