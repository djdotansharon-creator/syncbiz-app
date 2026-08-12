import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { GoogleAuth } from "google-auth-library";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * Hebrew Voice Benchmark v0 — ISOLATED evaluation endpoint (OFF-PLAYBACK).
 * Generates the SAME spoken text with one of three engines and stores the MP3 exactly like
 * the normal jingle flow (data/jingles/<id>.mp3 → served by /api/jingles/audio/<id>), so the
 * existing Browser Preview can audition it. This route is SEPARATE from /api/jingles/generate;
 * the product's default Generate flow is untouched. One candidate per request → failures are
 * isolated (one engine failing never affects the others).
 */

// Gemini-TTS delivery styles → natural-language prompt (benchmark control only, not a Styles system).
const GEMINI_PROMPTS: Record<string, string> = {
  Neutral: "Professional retail store announcement, clear and natural.",
  Energetic: "Energetic professional radio retail announcer. Confident, exciting and sales-focused without sounding aggressive.",
  Premium: "Warm, premium and polished department-store announcer.",
  Urgent: "Professional promotional announcement with a sense of urgency — the offer ends soon.",
};

// Fixed benchmark voices per gender (existing ElevenLabs voices support v3; Google names from voices:list).
const VOICES = {
  male: { eleven: "pNInz6obpgDQGcFmaJgB" /* Adam */, chirp: "he-IL-Chirp3-HD-Charon", gemini: "Charon" },
  female: { eleven: "21m00Tcm4TlvDq8ikWAM" /* Rachel */, chirp: "he-IL-Chirp3-HD-Kore", gemini: "Kore" },
} as const;

const ELEVEN_V3_MODEL = "eleven_v3";
const GEMINI_MODEL = "gemini-2.5-flash-tts";
const CHIRP_MODEL_LABEL = "Chirp3-HD";
const TTS_SYNTH_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

function jinglesDir(): string {
  const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return vol ? join(vol, "jingles") : join(process.cwd(), "data", "jingles");
}

async function saveMp3(buf: Buffer): Promise<string> {
  const id = randomUUID();
  const dir = jinglesDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.mp3`), buf);
  return `/api/jingles/audio/${id}`;
}

/** A — ElevenLabs v3 (expressive via audio tags in the text; no `speed` param on v3). */
async function synthElevenV3(text: string, voiceId: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: ELEVEN_V3_MODEL }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Google Cloud Text-to-Speech (Chirp 3 HD or Gemini-TTS) via local ADC user credentials. */
async function synthGoogle(body: Record<string, unknown>): Promise<Buffer> {
  const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
  const client = await auth.getClient();
  // getRequestHeaders() carries the Authorization token AND `x-goog-user-project` (the ADC
  // quota project set via `gcloud auth application-default set-quota-project`), which the
  // Text-to-Speech API requires for user ADC credentials.
  const authHeaders = await client.getRequestHeaders();
  const headers = new Headers(authHeaders as HeadersInit);
  headers.set("Content-Type", "application/json");
  if (!headers.has("x-goog-user-project") && process.env.GOOGLE_CLOUD_PROJECT) {
    headers.set("x-goog-user-project", process.env.GOOGLE_CLOUD_PROJECT);
  }
  if (!headers.has("authorization")) throw new Error("Google ADC token unavailable (run `gcloud auth application-default login`)");
  const res = await fetch(TTS_SYNTH_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { audioContent?: string; error?: { message?: string; status?: string } };
  if (!res.ok || json.error) throw new Error(`GoogleTTS ${res.status}: ${(json.error?.message || json.error?.status || "unknown").slice(0, 220)}`);
  if (!json.audioContent) throw new Error("GoogleTTS returned no audioContent");
  return Buffer.from(json.audioContent, "base64");
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    candidate?: "A" | "B" | "C";
    text?: string;
    gender?: "male" | "female";
    style?: keyof typeof GEMINI_PROMPTS;
  };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (text.length > 2500) return NextResponse.json({ error: "text too long (max 2500)" }, { status: 400 });
  const gender: "male" | "female" = body.gender === "female" ? "female" : "male";
  const v = VOICES[gender];

  try {
    let buf: Buffer;
    let meta: { provider: string; model: string; voice: string };
    if (body.candidate === "A") {
      buf = await synthElevenV3(text, v.eleven);
      meta = { provider: "ElevenLabs", model: ELEVEN_V3_MODEL, voice: v.eleven };
    } else if (body.candidate === "B") {
      buf = await synthGoogle({
        input: { text },
        voice: { languageCode: "he-IL", name: v.chirp },
        audioConfig: { audioEncoding: "MP3" },
      });
      meta = { provider: "Google", model: CHIRP_MODEL_LABEL, voice: v.chirp };
    } else if (body.candidate === "C") {
      const style = body.style && GEMINI_PROMPTS[body.style] ? body.style : "Neutral";
      buf = await synthGoogle({
        input: { prompt: GEMINI_PROMPTS[style], text },
        voice: { languageCode: "he-IL", name: v.gemini, modelName: GEMINI_MODEL },
        audioConfig: { audioEncoding: "MP3" },
      });
      meta = { provider: "Google", model: `${GEMINI_MODEL} · ${style}`, voice: v.gemini };
    } else {
      return NextResponse.json({ error: "candidate must be A, B or C" }, { status: 400 });
    }
    const url = await saveMp3(buf);
    return NextResponse.json({ url, bytes: buf.byteLength, ...meta });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Isolated failure: return the exact error for THIS candidate only.
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
