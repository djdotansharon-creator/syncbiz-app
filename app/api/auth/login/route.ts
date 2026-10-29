import { NextRequest, NextResponse } from "next/server";
import { validateCredentialsAsync, createSessionValue } from "@/lib/auth";
import { getOrCreateUserByEmail } from "@/lib/user-store";
import { prisma } from "@/lib/prisma";
import { emitEvent, EVENT_TYPES } from "@/lib/analytics-boundary";
import { ACTIVE_WORKSPACE_COOKIE_NAME } from "@/lib/active-workspace-constants";
import { attemptKeys, blockedFor, recordFailure, recordSuccess } from "@/lib/auth-rate-limit";

const COOKIE_NAME = "syncbiz-session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const normEmail = String(email).trim().toLowerCase();

    // security hotfix 2026-10-13: brute-force protection (5 failures / account, 20 / address, 15 min block)
    const rateKeys = attemptKeys("login", normEmail, req.headers);
    const wait = blockedFor(rateKeys);
    if (wait > 0) return NextResponse.json({ error: "Too many attempts. Try again later.", retryAfterSec: Math.ceil(wait / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });

    if (!(await validateCredentialsAsync(normEmail, password))) {
      rateKeys.forEach((k) => recordFailure(k));
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    rateKeys.forEach((k) => recordSuccess(k));
    const user = await getOrCreateUserByEmail(normEmail);
    // when this person last signed in (shown on the Permissions screen; the column already exists) — best effort, never delays or fails a login
    void prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
    emitEvent(EVENT_TYPES.USER_LOGIN, { userId: user.id, email: user.email });

    const sessionValue = await createSessionValue(normEmail);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, sessionValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
    // Prevent a stale active-workspace UUID from applying to this account/session.
    res.cookies.set(ACTIVE_WORKSPACE_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
