import { NextRequest, NextResponse } from "next/server";
import { isJoinEnvEnabled } from "@/lib/join-by-code";
import { JoinError, claimJoinCode } from "@/lib/join-by-code-store";

/** Public (no session): the person opened the join link — keep this code alive while he fills in his details (see claimJoinCode). POST { code }. */
export async function POST(req: NextRequest) {
  if (!isJoinEnvEnabled()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  try {
    const b = (await req.json()) as Record<string, unknown>;
    await claimJoinCode(typeof b.code === "string" ? b.code : "", req.headers);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof JoinError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    console.error("[api/join/claim] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
