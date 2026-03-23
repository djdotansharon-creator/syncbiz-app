import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { createWsToken } from "@/lib/auth-ws-token";

/** Returns short-lived token for WS REGISTER. Requires authenticated session. Uses stable userId. */
export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const token = createWsToken(user.id);
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: "Token creation failed" }, { status: 500 });
  }
}
