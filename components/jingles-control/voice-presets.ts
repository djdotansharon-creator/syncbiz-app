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
export type VoiceGender = "male" | "female";

export type VoicePreset = { label: string; voiceId: string; gender: VoiceGender };

export const VOICE_PRESETS_BY_LANG: Record<JingleLanguage, readonly VoicePreset[]> = {
  en: [
    { label: "Announcer Male",   voiceId: "JBFqnCBsd6RMkjVDRZzb", gender: "male" }, // George
    { label: "Announcer Female", voiceId: "EXAVITQu4vr4xnSDxMaL", gender: "female" }, // Sarah
    { label: "Energetic Male",   voiceId: "TX3LPaxmHKxFdv7VOQHJ", gender: "male" }, // Liam
    { label: "Energetic Female", voiceId: "cgSgspJ2msm6clMCkdW9", gender: "female" }, // Jessica
  ],
  he: [
    // VONO Hebrew voices (owner's ElevenLabs workspace, Voice Design) — routed through
    // eleven_v3 by a per-voice override in /api/jingles/generate.
    { label: "Arik – Promo", voiceId: "3FkAarM52pFyMPwrjibn", gender: "male" }, // VONO ARIK — ads / promotions
    { label: "Arik – Calm",  voiceId: "PrXG2tarAqfndr3EoSEJ", gender: "male" }, // VONO ARIK Calm — service announcements
    { label: "Noa",          voiceId: "TMWQTwRNEzBaAxVppnW3", gender: "female" }, // VONO NOA
    { label: "Ayala",        voiceId: "CqGwkZu0hf7cvRYmyKMz", gender: "female" }, // VONO Ayala
    { label: "Neomi",        voiceId: "aw3sjQ0zB8LAt39aeeTR", gender: "female" }, // VONO Neomi
  ],
};

const GENDER_LABEL: Record<JingleLanguage, Record<VoiceGender, string>> = {
  en: { male: "Male", female: "Female" },
  he: { male: "גבר", female: "אישה" },
};

/** Menu label with the voice's gender ("Noa · אישה"); English labels already name it, so they stay as-is. */
export function voiceMenuLabel(voice: VoicePreset, language: JingleLanguage): string {
  const gender = GENDER_LABEL[language][voice.gender];
  return voice.label.includes(gender) ? voice.label : `${voice.label} · ${gender}`;
}
