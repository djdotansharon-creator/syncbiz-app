import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { houseAnnouncer } from "@/lib/voice-lab";

export const dynamic = "force-dynamic";

/**
 * Voice-to-Voice BOUNDARY (Part D) — recorded audio → authorized target announcer → MP3.
 *
 * This is a boundary ONLY, not a working converter and not a provider framework. Speech-to-speech
 * is NOT approved for production in ANY locale: ElevenLabs STS does not list Hebrew, and every
 * locale requires proof before it may be enabled. So this route deliberately DOES NOT convert —
 * it validates the shape and reports capability, returning 501 until a locale is proven + a target
 * House Announcer is configured. No audio is ever sent to a provider here.
 */

// Locales with PROVEN speech-to-speech support. Empty until proof exists (Hebrew is NOT proven).
const STS_PROVEN_LOCALES: string[] = [];

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const locale = String(form?.get("locale") ?? "he-IL");
  const hasAudio = form?.get("audio") instanceof Blob;

  const house = houseAnnouncer();
  const localeProven = STS_PROVEN_LOCALES.includes(locale);

  return NextResponse.json(
    {
      enabled: false,
      reason: !house
        ? "No authorized House Announcer target is configured."
        : !localeProven
          ? `Voice-to-Voice is not proven/approved for locale ${locale}.`
          : "Voice-to-Voice is not enabled in this build.",
      capability: { houseAnnouncerConfigured: !!house, localeProven, audioReceived: hasAudio },
    },
    { status: 501 },
  );
}

export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const house = houseAnnouncer();
  return NextResponse.json({ enabled: false, houseAnnouncerConfigured: !!house, provenLocales: STS_PROVEN_LOCALES });
}
