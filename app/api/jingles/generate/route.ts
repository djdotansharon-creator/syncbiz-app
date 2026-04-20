import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
// Sarah — free-tier confirmed. Override with ELEVENLABS_VOICE_ID env var.
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
// Model choice per language:
//  - en  → turbo_v2_5 (fast, supports top-level `speed`, excellent English)
//  - he  → multilingual_v2 (much better Hebrew naturalness than turbo)
const MODEL_BY_LANG: Record<"en" | "he", string> = {
  en: "eleven_turbo_v2_5",
  he: "eleven_multilingual_v2",
};
// Speed presets → ElevenLabs `speed` param (turbo model) / stability nudge (multilingual).
const SPEED_VALUES: Record<"slow" | "normal" | "fast", number> = {
  slow:   0.75,
  normal: 0.9,
  fast:   1.05,
};

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

  const body = (await req.json()) as {
    text?: string;
    voiceId?: string;
    language?: "en" | "he";
    speed?: "slow" | "normal" | "fast";
  };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (text.length > 2500) return NextResponse.json({ error: "text too long (max 2500 chars)" }, { status: 400 });

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 503 });

  const voiceId = (body.voiceId ?? "").trim()
    || process.env.ELEVENLABS_VOICE_ID?.trim()
    || DEFAULT_VOICE_ID;

  const language: "en" | "he" = body.language === "he" ? "he" : "en";
  const speedKey: "slow" | "normal" | "fast" =
    body.speed === "slow" || body.speed === "fast" ? body.speed : "normal";
  const speedValue = SPEED_VALUES[speedKey];
  const modelId = MODEL_BY_LANG[language];

  /** `speed` is a top-level param on turbo_v2_5; multilingual_v2 ignores it
   *  silently but accepts it in the payload. For multilingual we also push
   *  stability higher to reduce English-accented Hebrew artifacts. */
  const voiceSettings =
    language === "he"
      ? { stability: 0.6, similarity_boost: 0.85, style: 0.15, use_speaker_boost: true }
      : { stability: 0.55, similarity_boost: 0.75 };

  const ttsBody: Record<string, unknown> = {
    text,
    model_id: modelId,
    speed: speedValue,
    voice_settings: voiceSettings,
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

  console.log(
    `[jingles/generate] saved ${audioBuffer.byteLength}B → ${id}.mp3 ` +
      `(voice=${voiceId} lang=${language} model=${modelId} speed=${speedKey}/${speedValue})`,
  );

  return NextResponse.json({
    id,
    url: `/api/jingles/audio/${id}`,
    durationLabel: estimateDurationLabel(text),
  });
}
