/**
 * Making a jingle on the display screen (owner 2026-10-26: "in Jingles put the whole creating-a-jingle thing — as simple and easy as possible"). The same endpoints the Jingles console uses
 * (`/api/jingles/generate` → the spoken MP3; `/api/jingles/pads` = the button on the screen; `/api/jingles/library` = the shared list), with every choice made for the owner:
 * the language is detected from the words, the voice is the first of that language, the speed is normal, the bell is a "ding". Pure helpers here so they can be tested without a screen.
 */
import type { SamplerPadItem } from "@/components/jingles-control/types";

export type JingleLanguage = "he" | "en";

/** Hebrew letters in the text → Hebrew, anything else → English (the console starts the same way: "detected from the words themselves") */
export function detectJingleLanguage(text: string): JingleLanguage {
  return /[֐-׿]/.test(text) ? "he" : "en";
}

/** the name of the button: the first three words, at most 20 characters (the console's limit for a pad label) */
export function jingleButtonLabel(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
  return (words || "Jingle").slice(0, 20);
}

/** the first of the screen's buttons that has no jingle yet (null = all eight are taken) */
export function firstFreePad(pads: ReadonlyArray<SamplerPadItem>): SamplerPadItem | null {
  return pads.find((p) => !p.url) ?? null;
}

/** "0:07" → 7 (the library keeps the length in seconds) */
export function durationLabelToSec(label: string | undefined): number | null {
  const m = (label ?? "").match(/^(\d+):(\d{1,2})$/);
  return m ? parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10) : null;
}

export type GeneratedJingle = { url: string; durationLabel: string };

/** Speaks the text (server-side text-to-speech). Throws with the server's own message when it fails (for example no voice service is configured). */
export async function generateJingle(text: string, language: JingleLanguage, voiceId: string): Promise<GeneratedJingle> {
  const res = await fetch("/api/jingles/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId, language, speed: "normal" }),
  });
  let data: { url?: string; durationLabel?: string; error?: string } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    /* no body */
  }
  if (!res.ok || !data.url) throw new Error(data.error ?? `HTTP ${res.status}`);
  return { url: data.url, durationLabel: data.durationLabel ?? "—" };
}
