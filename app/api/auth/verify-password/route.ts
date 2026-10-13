import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, validateCredentialsAsync } from "@/lib/auth";
import { attemptKeys, blockedFor, recordFailure, recordSuccess } from "@/lib/auth-rate-limit";

const COOKIE_NAME = "syncbiz-session";

/**
 * Verifies the current user's password. Used for sensitive actions (e.g. MASTER promotion).
 * Does not expose or return any password data.
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(COOKIE_NAME)?.value;
    const email = cookie ? await parseSessionValue(cookie) : null;

    if (!email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { password } = body as { password?: string };

    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Password is required" },
        { status: 400 }
      );
    }

    // security hotfix 2026-10-13: manager re-auth is rate-limited like login
    const rateKeys = attemptKeys("reauth", email, req.headers);
    const wait = blockedFor(rateKeys);
    if (wait > 0) return NextResponse.json({ error: "Too many attempts. Try again later.", retryAfterSec: Math.ceil(wait / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });

    if (!(await validateCredentialsAsync(email, password))) {
      rateKeys.forEach((k) => recordFailure(k));
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401 }
      );
    }

    rateKeys.forEach((k) => recordSuccess(k));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
