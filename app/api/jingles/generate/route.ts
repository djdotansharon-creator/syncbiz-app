import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
// Sarah — free-tier confirmed. Override with ELEVENLABS_VOICE_ID env var.
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
// eleven_turbo_v2_5: supports top-level `speed` param + auto-detects Hebrew
const DEFAULT_MODEL = "eleven_turbo_v2_5";
// 0.85 feels natural for announcements; multilingual model default is too fast
const DEFAULT_SPEED = 0.85;

function jinglesDir(): string {
  const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return vol ? join(vol, "jingles") : join(process.cwd(), "data", "jingles");
}

function estimateDurationLabel(text: string): string {
  const words = text.trim().split(/\s+/).length;
  const sec = Math.max(2, Math.round(words / 2.5));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `0:${s.toString().padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { text?: string; voiceId?: string };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (text.length > 2500) return NextResponse.json({ error: "text too long (max 2500 chars)" }, { status: 400 });

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 503 });

  const voiceId = (body.voiceId ?? "").trim()
    || process.env.ELEVENLABS_VOICE_ID?.trim()
    || DEFAULT_VOICE_ID;

  // eleven_turbo_v2_5 auto-detects Hebrew (and all other languages supported by
  // eleven_multilingual_v2) without a language_code parameter — passing one causes 400.
  const ttsBody = {
    text,
    model_id: DEFAULT_MODEL,
    speed: DEFAULT_SPEED,
    voice_settings: { stability: 0.55, similarity_boost: 0.75 },
  };

  let audioBuffer: Buffer;
  try {
    const res = await fetch(`${ELEVENLABS_TTS_URL}/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(ttsBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[jingles/generate] ElevenLabs error", res.status, errText.slice(0, 300));
      return NextResponse.json(
        { error: `ElevenLabs error ${res.status}: ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    audioBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[jingles/generate] fetch failed:", msg);
    return NextResponse.json({ error: `ElevenLabs unreachable: ${msg}` }, { status: 502 });
  }

  const id = randomUUID();
  const dir = jinglesDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.mp3`), audioBuffer);

  console.log(`[jingles/generate] saved ${audioBuffer.byteLength}B → ${id}.mp3 (voice=${voiceId})`);

  return NextResponse.json({
    id,
    url: `/api/jingles/audio/${id}`,
    durationLabel: estimateDurationLabel(text),
  });
}
