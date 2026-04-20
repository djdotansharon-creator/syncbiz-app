/**
 * GET /api/jingles/bell/[style]
 *
 * Synthesizes a short pre-roll "bell" sound as a mono 16-bit PCM WAV directly
 * in memory (no external assets, no binary files in the repo, no FFmpeg).
 *
 * Three styles are supported:
 *   - `ding`  — single crisp sine (A5) with exponential decay
 *   - `chime` — two overlapping sines (G5 → C6) for a clean 2-tone chime
 *   - `soft`  — muted round tone (C5) with a subtle sub-harmonic
 *
 * Response is cached aggressively (24h). The bytes are fully deterministic for
 * a given style so browser + MPV cache layers both deduplicate.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAMPLE_RATE = 44100;
const BIT_DEPTH = 16;
const NUM_CHANNELS = 1;

type Tone = {
  freq: number;      // Hz
  startSec: number;  // when in the clip the tone starts
  durSec: number;    // decay length
  amp: number;       // 0..1 — peak amplitude for this tone
  /** optional constant sub-harmonic mixed at 1/3 level for warmth */
  sub?: number;
};

type Style = {
  totalSec: number;
  tones: Tone[];
  /** soft exponential tail to prevent click at end-of-buffer */
  tailSec?: number;
};

const STYLES: Record<string, Style> = {
  // Single "ding" ~0.5s — bright, clean.
  ding: {
    totalSec: 0.5,
    tones: [{ freq: 880, startSec: 0, durSec: 0.5, amp: 0.85 }],
  },
  // Two-note chime G5 → C6, ~0.85s total.
  chime: {
    totalSec: 0.85,
    tones: [
      { freq: 783.99, startSec: 0.0,  durSec: 0.55, amp: 0.75 },
      { freq: 1046.5, startSec: 0.18, durSec: 0.65, amp: 0.75 },
    ],
  },
  // Softer round tone — C5 + subtle low harmonic, longer decay.
  soft: {
    totalSec: 0.8,
    tones: [{ freq: 523.25, startSec: 0, durSec: 0.8, amp: 0.7, sub: 261.63 }],
  },
};

function writeWavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (SAMPLE_RATE * NUM_CHANNELS * BIT_DEPTH) / 8;
  const blockAlign = (NUM_CHANNELS * BIT_DEPTH) / 8;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(NUM_CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BIT_DEPTH, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/** Render a `Style` to a WAV Buffer. Uses exponential decay envelope per tone. */
function renderWav(style: Style): Buffer {
  const totalSamples = Math.ceil(style.totalSec * SAMPLE_RATE);
  const dataBytes = totalSamples * 2;
  const data = Buffer.alloc(dataBytes);
  const twoPi = Math.PI * 2;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    let sample = 0;

    for (const tone of style.tones) {
      if (t < tone.startSec) continue;
      const localT = t - tone.startSec;
      if (localT > tone.durSec) continue;
      // Exponential decay — bell-like envelope, shape τ ≈ durSec / 3.5.
      const env = Math.exp(-localT * (3.5 / tone.durSec));
      sample += Math.sin(twoPi * tone.freq * localT) * env * tone.amp;
      if (tone.sub) {
        sample += Math.sin(twoPi * tone.sub * localT) * env * tone.amp * 0.35;
      }
    }

    // Gentle fade-out on the very last 20ms to kill any residual click.
    const tailStart = style.totalSec - 0.02;
    if (t > tailStart) {
      const fade = Math.max(0, 1 - (t - tailStart) / 0.02);
      sample *= fade;
    }

    // Clip to [-1, 1] then convert to 16-bit signed.
    const clipped = Math.max(-1, Math.min(1, sample));
    const pcm = Math.round(clipped * 32767);
    data.writeInt16LE(pcm, i * 2);
  }

  const header = writeWavHeader(dataBytes);
  return Buffer.concat([header, data]);
}

// Per-process memo cache — each style is deterministic.
const cache = new Map<string, Buffer>();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ style: string }> },
) {
  const { style: raw } = await params;
  const key = (raw ?? "").toLowerCase();
  const style = STYLES[key];
  if (!style) {
    return NextResponse.json(
      { error: `Unknown bell style "${key}". Valid: ${Object.keys(STYLES).join(", ")}` },
      { status: 404 },
    );
  }

  let buf = cache.get(key);
  if (!buf) {
    buf = renderWav(style);
    cache.set(key, buf);
  }

  // Copy into a fresh ArrayBuffer — Next's BodyInit overloads accept ArrayBuffer
  // without needing the Node-only `Buffer` typing.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new NextResponse(ab, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "public, max-age=86400, immutable",
      "Accept-Ranges": "bytes",
    },
  });
}
