import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/user-store";
import { isResendConfigured, sendPasswordResetEmail } from "@/lib/email/resend-transactional";

const GENERIC_MESSAGE = "If that email exists, a reset link has been sent.";

/** Public site URL for links in email (Railway: set to your `https://…` app URL if `req.nextUrl.origin` is wrong behind a proxy). */
function publicAppOrigin(req: NextRequest): string {
  const raw = process.env.SYNCBIZ_PUBLIC_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      /* ignore */
    }
  }
  return req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    }
    const token = await createPasswordResetToken(email);
    const origin = publicAppOrigin(req);
    if (token) {
      const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
      if (process.env.NODE_ENV !== "production") {
        console.info("[auth/forgot-password] reset link", { email, resetUrl });
        return NextResponse.json({ ok: true, message: GENERIC_MESSAGE, resetUrl });
      }

      if (isResendConfigured()) {
        const sent = await sendPasswordResetEmail({ to: email, resetUrl });
        if (!sent.ok) {
          console.error("[auth/forgot-password] Resend failed", { email, error: sent.error });
        } else {
          console.info("[auth/forgot-password] email sent", { email });
        }
      } else {
        console.error(
          "[auth/forgot-password] RESEND_API_KEY is missing — set it in Railway to deliver reset emails. Token was created in DB; user will not see an email until mail is configured.",
          { email },
        );
      }
    }
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (e) {
    console.error("[auth/forgot-password]", e);
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }
}
