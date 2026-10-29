import { NextRequest, NextResponse } from "next/server";
import { isJoinEnvEnabled } from "@/lib/join-by-code";
import { JoinError, submitJoinRequest } from "@/lib/join-by-code-store";
import { EntitlementLimitError } from "@/lib/entitlement-limits";

/** Public (no session): a person typed a one-time code and sends their details. A new person gets no account until an admin approves. */
export async function POST(req: NextRequest) {
  if (!isJoinEnvEnabled()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
    const out = await submitJoinRequest(
      { code: s("code"), email: s("email"), password: s("password"), firstName: s("firstName"), lastName: s("lastName"), phone: s("phone") },
      req.headers,
    );
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    if (e instanceof JoinError) return NextResponse.json({ error: e.code }, { status: e.httpStatus });
    if (e instanceof EntitlementLimitError) return NextResponse.json({ error: "limit" }, { status: 403 });
    console.error("[api/join/request] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "other" }, { status: 500 });
  }
}
