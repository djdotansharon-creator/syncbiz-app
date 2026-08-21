import type { JingleLanguage } from "./types";

/**
 * Curated jingle voices — the SINGLE source of truth shared by the Desktop JinglesShell and the
 * Mobile Jingles screen, so both surfaces show exactly the same voices. All IDs confirmed on
 * ElevenLabs' shared library; the multilingual model handles Hebrew via these voices. Labels are
 * customer-facing only — the voice IDs / provider are never shown.
 *
 * Extracted verbatim from JinglesShell (no value change) so Mobile mirrors Desktop rather than
 * building a parallel voice list.
 */
export const VOICE_PRESETS_BY_LANG: Record<JingleLanguage, readonly { label: string; voiceId: string }[]> = {
  en: [
    { label: "Announcer Male",   voiceId: "JBFqnCBsd6RMkjVDRZzb" }, // George
    { label: "Announcer Female", voiceId: "EXAVITQu4vr4xnSDxMaL" }, // Sarah
    { label: "Energetic Male",   voiceId: "TX3LPaxmHKxFdv7VOQHJ" }, // Liam
    { label: "Energetic Female", voiceId: "cgSgspJ2msm6clMCkdW9" }, // Jessica
  ],
  he: [
    // Professional Hebrew voices (ElevenLabs account, generated) — routed through
    // eleven_v3 by a per-voice override in /api/jingles/generate.
    { label: "Professional Announcer", voiceId: "JXH3lbmtWF1cUL9JEL4S" },
    { label: "Radio Announcer",        voiceId: "9sc3z1AF9BP2mmepHnXH" },
  ],
};
