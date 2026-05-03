/**
 * DJ Creator V1 wizard-only filters — not global catalog/search behavior.
 */

/** Romantic / Elegant / Premium / Calm paths: softer defaults, no rhythmic posture unless user opts in. */
export const DJ_CREATOR_REFINED_VIBE_IDS = new Set(["romantic", "premium", "calm"]);

/**
 * Extra taxonomy slugs excluded on refined vibes when combined with DJ rule `avoidStyleSlugs`
 * (`rhythmicOptIn` clears this).
 * Uses slug forms that commonly exist on CatalogItem tags (aligned with seeds / playbook).
 */
export const DJ_CREATOR_REFINED_VIBE_EXTRA_AVOID_SLUGS = [
  "style-electronic-deep-house",
  "style-electronic-edm",
  "deep-house",
  "afro",
  "afro-house",
  "electro-afro",
  "techno",
  "edm",
  "club",
  "trap",
  "style-electronic-trance",
  "trance",
];

export type WizardStyleBubble = {
  id: string;
  label: string;
  labelHe: string;
  query: string;
  daypartApi?: string;
};

function normKey(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

export function djCreatorRhythmicOptIn(vibeWizardId: string, styleBubbleId: string): boolean {
  const v = normKey(vibeWizardId);
  if (v === "energy" || v === "rhythmic") return true;
  return isRhythmicStyleBubble(normKey(styleBubbleId), "");
}

export function mergeDjCreatorAvoidSlugs(
  vibeId: string,
  ruleAvoid: string[] | undefined,
  rhythmicOptIn?: boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (x: string) => {
    const k = normKey(x);
    if (k.length < 1 || seen.has(k)) return;
    seen.add(k);
    out.push(x.trim());
  };
  for (const s of ruleAvoid ?? []) push(s);
  const refined = DJ_CREATOR_REFINED_VIBE_IDS.has(normKey(vibeId));
  if (refined && !rhythmicOptIn) {
    for (const s of DJ_CREATOR_REFINED_VIBE_EXTRA_AVOID_SLUGS) push(s);
  }
  return out;
}

/** V1 — never surface language / instrumental as style chips (catalog may still carry tags elsewhere). */
const HIDDEN_LANGUAGE_STYLE_IDS = new Set(["hebrew", "english", "international", "instrumental"]);

/** Default style bubbles excluded for refined moods unless rhythmic opt-in. */
const REFINED_BLOCKED_STYLE_IDS = new Set([
  "israeli",
  "israeli-local",
  "israeli_local",
  "afro",
  "house-edm",
  "edm-club",
]);

/** User picked an explicit rhythmic / dance direction on the style step. */
const RHYTHMIC_STYLE_IDS = new Set(
  ["afro", "house-edm", "edm-club", "dance", "trap", "lounge-house", "latin-club"].flatMap((s) => [
    s,
    s.replace(/-/g, "_"),
  ]),
);

function isRhythmicStyleBubble(id: string, query: string): boolean {
  if (RHYTHMIC_STYLE_IDS.has(id)) return true;
  return looksRhythmicClubQuery(query);
}

function looksRhythmicClubQuery(query: string): boolean {
  const q = normKey(query);
  return (
    /\bdeep[\s_-]*house\b/.test(q) ||
    /\bafro\b/.test(q) ||
    /\bhouse\b.*\bdance\b|\bdance\b.*\belectronic\b/.test(q) ||
    /\bedm\b|\btechno\b|\bclub\b|\btrap\b/i.test(q) ||
    /\bpeak\b|\bhiit\b/i.test(q)
  );
}

/**
 * Drops Israeli/local and language chips; trims rhythmic/club style options when vibe is refined
 * unless the user chose a rhythmic vibe or rhythmic style bubble.
 */
export function filterDjCreatorWizardStyleBubbles(vibeId: string, bubbles: WizardStyleBubble[]): WizardStyleBubble[] {
  let list = bubbles.filter((b) => {
    const id = normKey(b.id);
    if (id === "israeli" || id.startsWith("israeli")) return false;
    if (HIDDEN_LANGUAGE_STYLE_IDS.has(id)) return false;
    return true;
  });
  const v = normKey(vibeId);
  if (!DJ_CREATOR_REFINED_VIBE_IDS.has(v)) return list;

  list = list.filter((b) => !REFINED_BLOCKED_STYLE_IDS.has(normKey(b.id)));  list = list.filter((b) => !looksRhythmicClubQuery(b.query));
  return list;
}
