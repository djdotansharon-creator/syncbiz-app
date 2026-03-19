import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, validateCredentials } from "@/lib/auth";

const COOKIE_NAME = "syncbiz-session";

/**
 * Verifies the current user's password. Used for sensitive actions (e.g. MASTER promotion).
 * Does not expose or return any password data.
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(COOKIE_NAME)?.value;
    const email = cookie ? parseSessionValue(cookie) : null;

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

    if (!validateCredentials(email, password)) {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
