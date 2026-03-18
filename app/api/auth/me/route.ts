import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue } from "@/lib/auth";

const COOKIE_NAME = "syncbiz-session";

/** Returns current user email from session. Used for user-aware WS device registration. */
export async function GET() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;
  const email = cookie ? parseSessionValue(cookie) : null;
  if (!email) {
    return NextResponse.json({ email: null }, { status: 200 });
  }
  return NextResponse.json({ email });
}
