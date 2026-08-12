import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import {
  saveMp3,
  synthElevenV3,
  synthGoogleChirp,
  synthGoogleGemini,
  ELEVEN_V3_MODEL,
  GEMINI_MODEL,
  CHIRP_MODEL,
  GEMINI_PROMPTS,
  type VoiceProvider,
} from "@/lib/voice-lab";

export const dynamic = "force-dynamic";

/**
 * Hebrew Voice Benchmark v0 + INTERNAL Voice Lab generate — ISOLATED evaluation endpoint
 * (OFF-PLAYBACK). Generates the SAME spoken text with one engine and stores the MP3 exactly like
 * the normal jingle flow (data/jingles/<id>.mp3 → served by /api/jingles/audio/<id>), so the
 * existing Browser Preview can audition it. SEPARATE from /api/jingles/generate — the product's
 * default Generate flow is untouched. One request → one voice → failures stay isolated.
 *
 * Two request shapes (both supported):
 *   • Legacy benchmark:  { candidate: "A"|"B"|"C", text, gender, style? }   (fixed he-IL voices)
 *   • Voice Lab generate: { provider, voiceId, text, locale?, style? }       (any catalog voice)
 */

// Fixed benchmark voices per gender (legacy A/B/C shorthand; he-IL).
const VOICES = {
  male: { eleven: "pNInz6obpgDQGcFmaJgB" /* Adam */, chirp: "he-IL-Chirp3-HD-Charon", gemini: "Charon" },
  female: { eleven: "21m00Tcm4TlvDq8ikWAM" /* Rachel */, chirp: "he-IL-Chirp3-HD-Kore", gemini: "Kore" },
} as const;

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    candidate?: "A" | "B" | "C";
    provider?: VoiceProvider;
    voiceId?: string;
    locale?: string;
    text?: string;
    gender?: "male" | "female";
    style?: string;
  };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (text.length > 2500) return NextResponse.json({ error: "text too long (max 2500)" }, { status: 400 });

  try {
    let buf: Buffer;
    let meta: { provider: string; model: string; voice: string };

    if (body.provider && body.voiceId) {
      // ── Voice Lab: any catalog voice ──
      const locale = body.locale || "he-IL";
      const voiceId = body.voiceId;
      if (body.provider === "elevenlabs") {
        buf = await synthElevenV3(text, voiceId);
        meta = { provider: "ElevenLabs", model: ELEVEN_V3_MODEL, voice: voiceId };
      } else if (body.provider === "google-chirp") {
        buf = await synthGoogleChirp(text, voiceId, locale);
        meta = { provider: "Google", model: CHIRP_MODEL, voice: voiceId };
      } else if (body.provider === "google-gemini") {
        const style = body.style && GEMINI_PROMPTS[body.style] ? body.style : "Neutral";
        buf = await synthGoogleGemini(text, voiceId, locale, style);
        meta = { provider: "Google", model: `${GEMINI_MODEL} · ${style}`, voice: voiceId };
      } else {
        return NextResponse.json({ error: "unknown provider" }, { status: 400 });
      }
    } else {
      // ── Legacy A/B/C benchmark (fixed he-IL voices) ──
      const gender: "male" | "female" = body.gender === "female" ? "female" : "male";
      const v = VOICES[gender];
      if (body.candidate === "A") {
        buf = await synthElevenV3(text, v.eleven);
        meta = { provider: "ElevenLabs", model: ELEVEN_V3_MODEL, voice: v.eleven };
      } else if (body.candidate === "B") {
        buf = await synthGoogleChirp(text, v.chirp, "he-IL");
        meta = { provider: "Google", model: CHIRP_MODEL, voice: v.chirp };
      } else if (body.candidate === "C") {
        const style = body.style && GEMINI_PROMPTS[body.style] ? body.style : "Neutral";
        buf = await synthGoogleGemini(text, v.gemini, "he-IL", style);
        meta = { provider: "Google", model: `${GEMINI_MODEL} · ${style}`, voice: v.gemini };
      } else {
        return NextResponse.json({ error: "candidate must be A, B or C (or pass provider+voiceId)" }, { status: 400 });
      }
    }

    const url = await saveMp3(buf);
    return NextResponse.json({ url, bytes: buf.byteLength, ...meta });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
