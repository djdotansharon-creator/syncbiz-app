import { NextRequest, NextResponse } from "next/server";
import { validateCredentialsAsync, createSessionValue } from "@/lib/auth";
import { getOrCreateUserByEmail } from "@/lib/user-store";
import { emitEvent, EVENT_TYPES } from "@/lib/analytics-boundary";
import { ACTIVE_WORKSPACE_COOKIE_NAME } from "@/lib/active-workspace-constants";

const COOKIE_NAME = "syncbiz-session";
const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SESSION_MAX_AGE = 60 * 60 * 24; // 1 day when "Remember me" is off

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, rememberMe } = body as {
      email?: string;
      password?: string;
      rememberMe?: boolean;
    };

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const normEmail = String(email).trim().toLowerCase();

    if (!(await validateCredentialsAsync(normEmail, password))) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const user = await getOrCreateUserByEmail(normEmail);
    emitEvent(EVENT_TYPES.USER_LOGIN, { userId: user.id, email: user.email });

    const sessionValue = createSessionValue(normEmail);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, sessionValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: rememberMe === true ? REMEMBER_ME_MAX_AGE : SESSION_MAX_AGE,
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
