import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/user-store";

const GENERIC_MESSAGE = "If that email exists, a reset link has been sent.";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    }
    const token = await createPasswordResetToken(email);
    const origin = req.nextUrl.origin;
    if (token) {
      const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
      if (process.env.NODE_ENV !== "production") {
        console.info("[auth/forgot-password] reset link", { email, resetUrl });
        return NextResponse.json({ ok: true, message: GENERIC_MESSAGE, resetUrl });
      }
      // Production placeholder until email provider is configured.
      console.info("[auth/forgot-password] reset requested", { email });
    }
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }
}

