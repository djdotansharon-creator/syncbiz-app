import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, createWsToken } from "@/lib/auth";

const COOKIE_NAME = "syncbiz-session";

/** Returns short-lived token for WS REGISTER. Requires authenticated session. */
export async function GET() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value;
  const userId = cookie ? parseSessionValue(cookie) : null;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const token = createWsToken(userId);
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: "Token creation failed" }, { status: 500 });
  }
}
