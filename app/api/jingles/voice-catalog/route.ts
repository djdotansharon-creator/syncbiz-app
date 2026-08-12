import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { buildCatalog, VOICE_LOCALES } from "@/lib/voice-lab";

export const dynamic = "force-dynamic";

/**
 * INTERNAL Voice Lab catalog. Returns the voices each provider actually supports for a locale
 * (Google Chirp 3 HD + Gemini per languageCode, ElevenLabs account voices for v3). READ-ONLY /
 * OFF-PLAYBACK — lists voices; it does NOT synthesize (generation is on-demand per voice).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const locale = req.nextUrl.searchParams.get("locale") || "he-IL";
  try {
    const voices = await buildCatalog(locale);
    return NextResponse.json({ locale, locales: VOICE_LOCALES, voices });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
