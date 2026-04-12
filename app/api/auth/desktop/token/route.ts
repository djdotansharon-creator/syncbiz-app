import { NextRequest, NextResponse } from "next/server";
import { validateCredentialsAsync } from "@/lib/auth";
import { getOrCreateUserByEmail } from "@/lib/user-store";
import { createDesktopAccessToken, getDesktopTokenTtlSeconds } from "@/lib/auth-ws-token";
import { emitEvent, EVENT_TYPES } from "@/lib/analytics-boundary";

/**
 * Email/password → long-lived `desktop_access` bearer token (no session cookie).
 * Used by Electron desktop; same token works for HTTP Bearer and WS REGISTER.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body as { email?: string; password?: string };

    if (!email?.trim() || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    if (!(await validateCredentialsAsync(email, password))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const user = await getOrCreateUserByEmail(email);
    emitEvent(EVENT_TYPES.USER_LOGIN, { userId: user.id, email: user.email, via: "desktop_token" });

    const ttlSec = getDesktopTokenTtlSeconds();
    const token = createDesktopAccessToken(user.id);
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();

    return NextResponse.json({ token, expiresAt, expiresInSec: ttlSec });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("SYNCBIZ_WS_SECRET") || msg.includes("WS_SECRET")) {
      return NextResponse.json({ error: "Server token signing is not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
