import { NextRequest, NextResponse } from "next/server";
import { resetPasswordWithToken } from "@/lib/user-store";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { token?: string; password?: string };
    const token = (body.token ?? "").trim();
    const password = body.password ?? "";
    if (!token) {
      return NextResponse.json({ error: "Invalid reset token" }, { status: 400 });
    }
    const result = await resetPasswordWithToken(token, password);
    if (result === "weak_password") {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    if (result === "expired") {
      return NextResponse.json({ error: "Reset link expired" }, { status: 400 });
    }
    if (result === "invalid_token") {
      return NextResponse.json({ error: "Invalid reset token" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

