import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";

// Pings AudD with the configured token → Node runtime.
export const runtime = "nodejs";

const AUDD_ENDPOINT = "https://api.audd.io/";

/**
 * Owner-only setup check: is AUDD_API_TOKEN present AND accepted by AudD?
 *
 * We send a token-only probe (no audio) — AudD replies with error_code 900/901
 * ("Wrong/No API token") for a bad token, and a DIFFERENT error (or success)
 * when the token is accepted. That lets us report valid/invalid without ever
 * exposing the token and without spending a real recognition. Open this URL in a
 * browser while signed in as the platform owner.
 *
 * Returns { configured, tokenValid, detail }.
 */
export async function GET() {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const token = (process.env.AUDD_API_TOKEN ?? "").trim();
  if (!token) return NextResponse.json({ configured: false, tokenValid: false, detail: "AUDD_API_TOKEN is not set" });

  const out = new FormData();
  out.append("api_token", token);

  let res: Response;
  try {
    res = await fetch(AUDD_ENDPOINT, { method: "POST", body: out, signal: AbortSignal.timeout(15000) });
  } catch {
    return NextResponse.json({ configured: true, tokenValid: null, detail: "Couldn't reach AudD (network/timeout)" });
  }

  const data = (await res.json().catch(() => null)) as
    | { status?: string; error?: { error_code?: number; error_message?: string } }
    | null;

  if (!data) return NextResponse.json({ configured: true, tokenValid: null, detail: "AudD returned an unreadable response" });

  const code = data.error?.error_code;
  const msg = data.error?.error_message ?? "";
  // 900 = Wrong API token, 901 = No api_token. Anything else = the token was
  // accepted (AudD then complains about the missing file, which is expected).
  const tokenBad = code === 900 || code === 901 || /api token/i.test(msg);

  return NextResponse.json({
    configured: true,
    tokenValid: !tokenBad,
    detail: tokenBad
      ? `AudD rejected the token: ${msg || `error ${code}`}`
      : `Token accepted by AudD${msg ? ` (probe reply: ${msg})` : ""}`,
  });
}
