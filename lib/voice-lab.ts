/**
 * Voice Lab — shared server helpers for the INTERNAL voice catalog + generation.
 *
 * OFF-PLAYBACK: every function ends at an MP3 buffer / audio URL. Nothing here touches the
 * playback runtime (MPV / MASTER / CONTROL / Automix / queue / ducking / desktop). Reused by
 * /api/jingles/benchmark, /api/jingles/voice-catalog and /api/voice/convert.
 *
 * This is a thin set of helpers, NOT a provider framework: three concrete synth functions +
 * two catalog fetchers + local MP3 storage. Locale-aware; a provider only appears for a locale
 * when it actually returns voices for it.
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { GoogleAuth } from "google-auth-library";

export type VoiceProvider = "elevenlabs" | "google-chirp" | "google-gemini";
export type Gender = "male" | "female" | "unknown";

/** Internal creation metadata (international foundation; no DB — in-memory/type only). */
export type VoiceCreation = {
  locale: string;
  originalText: string;
  spokenText: string;
  provider: VoiceProvider;
  model: string;
  voiceId: string;
  style?: string;
  sourceType: "text" | "recording";
  generatedAudioUrl: string;
};

export type CatalogVoice = {
  provider: VoiceProvider;
  model: string;
  voiceId: string; // ElevenLabs voice_id, Google Chirp full name, or Gemini persona name
  name: string;
  gender: Gender;
  locale: string;
  previewUrl: string | null; // native sample without synthesis (ElevenLabs only today)
  supportsStyle: boolean; // Gemini delivery prompts
  house?: boolean; // pinned House Announcer
};

/** Target locales. `enabled` gates whether the product may USE the locale (proof-required). */
export const VOICE_LOCALES: { code: string; label: string; enabled: boolean }[] = [
  { code: "he-IL", label: "Hebrew", enabled: true },
  { code: "en-US", label: "English (US)", enabled: true },
  { code: "en-GB", label: "English (UK)", enabled: true },
  { code: "it-IT", label: "Italian", enabled: true },
  { code: "ar-XA", label: "Arabic (future)", enabled: false },
];

export const ELEVEN_V3_MODEL = "eleven_v3";
export const GEMINI_MODEL = "gemini-2.5-flash-tts";
export const CHIRP_MODEL = "Chirp3-HD";
const TTS_SYNTH_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const TTS_VOICES_URL = "https://texttospeech.googleapis.com/v1/voices";

/** Gemini delivery styles → natural-language prompt (internal eval control; not a customer Styles system). */
export const GEMINI_PROMPTS: Record<string, string> = {
  Neutral: "Professional retail store announcement, clear and natural.",
  Sales: "Friendly professional retail announcer making a sales offer, warm and persuasive.",
  Energetic: "Energetic professional radio retail announcer. Confident, exciting and sales-focused without sounding aggressive.",
  Premium: "Warm, premium and polished department-store announcer.",
  Urgent: "Professional promotional announcement with a sense of urgency — the offer ends soon.",
};

export function jinglesDir(): string {
  const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return vol ? join(vol, "jingles") : join(process.cwd(), "data", "jingles");
}

export async function saveMp3(buf: Buffer): Promise<string> {
  const id = randomUUID();
  const dir = jinglesDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.mp3`), buf);
  return `/api/jingles/audio/${id}`;
}

/** Google Cloud auth via local ADC (user creds). Adds x-goog-user-project (quota project). */
async function googleHeaders(): Promise<Headers> {
  const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
  const client = await auth.getClient();
  const headers = new Headers((await client.getRequestHeaders()) as HeadersInit);
  if (!headers.has("x-goog-user-project") && process.env.GOOGLE_CLOUD_PROJECT) {
    headers.set("x-goog-user-project", process.env.GOOGLE_CLOUD_PROJECT);
  }
  if (!headers.has("authorization")) {
    throw new Error("Google ADC token unavailable (run `gcloud auth application-default login`)");
  }
  return headers;
}

async function googleSynth(body: Record<string, unknown>): Promise<Buffer> {
  const headers = await googleHeaders();
  headers.set("Content-Type", "application/json");
  const res = await fetch(TTS_SYNTH_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { audioContent?: string; error?: { message?: string; status?: string } };
  if (!res.ok || json.error) throw new Error(`GoogleTTS ${res.status}: ${(json.error?.message || json.error?.status || "unknown").slice(0, 220)}`);
  if (!json.audioContent) throw new Error("GoogleTTS returned no audioContent");
  return Buffer.from(json.audioContent, "base64");
}

// ── Synthesis (each returns an MP3 Buffer) ───────────────────────────────────
export async function synthElevenV3(text: string, voiceId: string): Promise<Buffer> {
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

export function synthGoogleChirp(text: string, voiceName: string, locale: string): Promise<Buffer> {
  return googleSynth({ input: { text }, voice: { languageCode: locale, name: voiceName }, audioConfig: { audioEncoding: "MP3" } });
}

export function synthGoogleGemini(text: string, voiceName: string, locale: string, style: string): Promise<Buffer> {
  const prompt = GEMINI_PROMPTS[style] ?? GEMINI_PROMPTS.Neutral;
  return googleSynth({
    input: { prompt, text },
    voice: { languageCode: locale, name: voiceName, modelName: GEMINI_MODEL },
    audioConfig: { audioEncoding: "MP3" },
  });
}

// ── Catalog (dynamic; only returns what each provider actually supports for the locale) ──
async function fetchGoogleVoices(locale: string): Promise<CatalogVoice[]> {
  try {
    const headers = await googleHeaders();
    const res = await fetch(`${TTS_VOICES_URL}?languageCode=${encodeURIComponent(locale)}`, { headers });
    if (!res.ok) return [];
    const json = (await res.json()) as { voices?: { name: string; ssmlGender?: string }[] };
    const chirp = (json.voices ?? []).filter((v) => /Chirp3-HD/i.test(v.name));
    const out: CatalogVoice[] = [];
    for (const v of chirp) {
      const gender: Gender = v.ssmlGender === "MALE" ? "male" : v.ssmlGender === "FEMALE" ? "female" : "unknown";
      const persona = v.name.split("-").pop() ?? v.name;
      // Chirp 3 HD (baseline) — one entry per voice.
      out.push({ provider: "google-chirp", model: CHIRP_MODEL, voiceId: v.name, name: persona, gender, locale, previewUrl: null, supportsStyle: false });
      // Gemini-TTS reuses the same persona name + a model + delivery prompt (style).
      out.push({ provider: "google-gemini", model: GEMINI_MODEL, voiceId: persona, name: persona, gender, locale, previewUrl: null, supportsStyle: true });
    }
    return out;
  } catch {
    return []; // provider unavailable for this locale / no ADC → simply omit it
  }
}

async function fetchElevenVoices(): Promise<CatalogVoice[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
    if (!res.ok) return [];
    const json = (await res.json()) as { voices?: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string }[] };
    return (json.voices ?? []).map((v) => {
      const g = (v.labels?.gender ?? "").toLowerCase();
      const gender: Gender = g.includes("male") && !g.includes("female") ? "male" : g.includes("female") ? "female" : "unknown";
      // ElevenLabs voices are multilingual — usable with v3 for any target locale.
      return { provider: "elevenlabs" as const, model: ELEVEN_V3_MODEL, voiceId: v.voice_id, name: v.name, gender, locale: "*", previewUrl: v.preview_url ?? null, supportsStyle: false };
    });
  } catch {
    return [];
  }
}

/** Optional House Announcer / signature voice via config (never a hardcoded voice id in code). */
export function houseAnnouncer(): CatalogVoice | null {
  const raw = process.env.SYNCBIZ_HOUSE_ANNOUNCER?.trim();
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<CatalogVoice>;
    if (!c.provider || !c.voiceId) return null;
    return {
      provider: c.provider as VoiceProvider,
      model: c.model ?? "",
      voiceId: c.voiceId,
      name: c.name ?? "House Announcer",
      gender: (c.gender as Gender) ?? "unknown",
      locale: c.locale ?? "*",
      previewUrl: c.previewUrl ?? null,
      supportsStyle: c.supportsStyle ?? false,
      house: true,
    };
  } catch {
    return null;
  }
}

export async function buildCatalog(locale: string): Promise<CatalogVoice[]> {
  const [google, eleven] = await Promise.all([fetchGoogleVoices(locale), fetchElevenVoices()]);
  const house = houseAnnouncer();
  return [...(house ? [house] : []), ...eleven, ...google];
}
