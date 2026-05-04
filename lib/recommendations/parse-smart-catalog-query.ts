/**
 * Stage 6 V1 — deterministic Hebrew/English keyword parsing for smart catalog search.
 * No AI, no embeddings. Produces structured hints for {@link WorkspaceFitContext} + dayparts.
 */

import type { BusinessType, WorkspaceEnergyLevel } from "@prisma/client";
import type { DaypartSegment } from "@/lib/recommendations/business-daypart-vibe.types";
import type { DaypartSlug } from "@/lib/recommendations/fit-rules.types";

export type ParsedSmartCatalogQuery = {
  rawQuery: string;
  normalizedForMatch: string;
  /** Venue from keywords, if any. */
  businessType: BusinessType | null;
  /** Fit-rules coarse daypart (morning / lunch / dinner / night). */
  coarseDaypart: DaypartSlug;
  /** Business-daypart vibe matrix segment. */
  vibeSegment: DaypartSegment;
  moodHints: string[];
  energyHint: WorkspaceEnergyLevel | null;
  /** Taxonomy slugs suggested by the query (may include slugs not yet in the dictionary). */
  styleTaxonomySlugs: string[];
  audienceHints: string[];
  conceptTags: string[];
  /** Human-readable tokens extracted (Hebrew + English phrases). */
  matchedPhrases: string[];
};

type PhraseMapEntry = {
  phrases: string[];
  apply: (draft: ParseDraft) => void;
};

type ParseDraft = {
  businessType: BusinessType | null;
  coarseDaypart: DaypartSlug | null;
  vibeSegment: DaypartSegment | null;
  moodHints: Set<string>;
  energyHint: WorkspaceEnergyLevel | null;
  styleTaxonomySlugs: Set<string>;
  audienceHints: Set<string>;
  conceptTags: Set<string>;
  matchedPhrases: Set<string>;
};

function lowerAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Lowercase ASCII; keep Hebrew and other scripts as-is; collapse whitespace. */
export function normalizeSmartQueryText(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  return lowerAscii(t);
}

function setBusiness(d: ParseDraft, b: BusinessType, phrase: string): void {
  if (!d.businessType) d.businessType = b;
  d.matchedPhrases.add(phrase);
}

function setCoarseDaypart(d: ParseDraft, p: DaypartSlug, phrase: string): void {
  if (!d.coarseDaypart) d.coarseDaypart = p;
  d.matchedPhrases.add(phrase);
}

function setVibeSegment(d: ParseDraft, s: DaypartSegment, phrase: string): void {
  if (!d.vibeSegment) d.vibeSegment = s;
  d.matchedPhrases.add(phrase);
}

function addMoods(d: ParseDraft, moods: string[], phrase: string): void {
  for (const m of moods) d.moodHints.add(m);
  d.matchedPhrases.add(phrase);
}

function addSlugs(d: ParseDraft, slugs: string[], phrase: string): void {
  for (const slug of slugs) d.styleTaxonomySlugs.add(slug);
  d.matchedPhrases.add(phrase);
}

function setEnergy(d: ParseDraft, e: WorkspaceEnergyLevel, phrase: string): void {
  if (!d.energyHint) d.energyHint = e;
  d.matchedPhrases.add(phrase);
}

function addAudience(d: ParseDraft, a: string[], phrase: string): void {
  for (const x of a) d.audienceHints.add(x);
  d.matchedPhrases.add(phrase);
}

function addConcept(d: ParseDraft, tags: string[], phrase: string): void {
  for (const t of tags) d.conceptTags.add(t);
  d.matchedPhrases.add(phrase);
}

/**
 * Ordered list: longer / more specific phrases first so "אחר הצהריים" wins over "ערב" adjacency.
 */
const PHRASE_MAP: PhraseMapEntry[] = [
  {
    phrases: ["אחר הצהריים", "אחרי הצהריים"],
    apply: (d) => {
      setCoarseDaypart(d, "lunch", "אחר הצהריים");
      setVibeSegment(d, "afternoon", "אחר הצהריים");
    },
  },
  {
    phrases: ["בית קפה"],
    apply: (d) => setBusiness(d, "CAFE", "בית קפה"),
  },
  {
    phrases: ["מכון כושר", "חדר כושר"],
    apply: (d) => setBusiness(d, "GYM", "מכון כושר"),
  },
  {
    phrases: ["לאונג׳", "לאונג'", "lounge"],
    apply: (d) => {
      addMoods(d, ["lounge", "calm"], "lounge");
      addSlugs(d, ["lounge"], "lounge");
    },
  },
  {
    phrases: ["בוסה", "bossa"],
    apply: (d) => addSlugs(d, ["bossa-nova"], "bossa"),
  },
  {
    phrases: ["צהריים"],
    apply: (d) => {
      setCoarseDaypart(d, "lunch", "צהריים");
      setVibeSegment(d, "lunch", "צהריים");
    },
  },
  {
    phrases: ["בוקר", "morning"],
    apply: (d) => {
      setCoarseDaypart(d, "morning", "בוקר");
      setVibeSegment(d, "morning", "בוקר");
    },
  },
  {
    phrases: ["לילה", "night"],
    apply: (d) => {
      setCoarseDaypart(d, "night", "לילה");
      setVibeSegment(d, "night", "לילה");
    },
  },
  {
    phrases: ["ערב", "evening"],
    apply: (d) => {
      setCoarseDaypart(d, "dinner", "ערב");
      setVibeSegment(d, "evening", "ערב");
    },
  },
  {
    phrases: ["dinner"],
    apply: (d) => {
      setCoarseDaypart(d, "dinner", "dinner");
      setVibeSegment(d, "dinner", "dinner");
    },
  },
  {
    phrases: ["lunch", "noon"],
    apply: (d) => {
      setCoarseDaypart(d, "lunch", "lunch");
      setVibeSegment(d, "lunch", "lunch");
    },
  },
  {
    phrases: ["afternoon"],
    apply: (d) => {
      setCoarseDaypart(d, "lunch", "afternoon");
      setVibeSegment(d, "afternoon", "afternoon");
    },
  },
  {
    phrases: ["מסעדה", "restaurant"],
    apply: (d) => setBusiness(d, "RESTAURANT", "מסעדה"),
  },
  {
    phrases: ["קפה", "cafe", "coffee"],
    apply: (d) => setBusiness(d, "CAFE", "קפה"),
  },
  {
    phrases: ["מלון", "hotel"],
    apply: (d) => setBusiness(d, "HOTEL", "מלון"),
  },
  {
    phrases: ["לובי", "lobby"],
    apply: (d) => {
      setBusiness(d, "HOTEL", "לובי");
      addMoods(d, ["lobby", "elegant"], "לובי");
    },
  },
  {
    phrases: ["gym", "fitness"],
    apply: (d) => setBusiness(d, "GYM", "gym"),
  },
  {
    phrases: ["בר", "bar"],
    apply: (d) => setBusiness(d, "BAR", "בר"),
  },
  {
    phrases: ["רומנטי", "romantic"],
    apply: (d) => {
      addMoods(d, ["romantic", "elegant", "wine"], "רומנטי");
      addSlugs(d, ["lounge", "bossa-nova", "jazz"], "רומנטי");
    },
  },
  {
    phrases: ["רגוע", "calm", "chill"],
    apply: (d) => {
      setEnergy(d, "LOW", "רגוע");
      addMoods(d, ["calm", "chill", "lounge"], "רגוע");
      addSlugs(d, ["lounge"], "רגוע");
    },
  },
  {
    phrases: ["אפרו", "afro"],
    apply: (d) => {
      addSlugs(d, ["afro"], "אפרו");
      addMoods(d, ["summer", "party"], "אפרו");
    },
  },
  {
    phrases: ["workout"],
    apply: (d) => {
      setEnergy(d, "HIGH", "workout");
      addMoods(d, ["workout"], "workout");
    },
  },
  {
    phrases: ["jazz"],
    apply: (d) => addSlugs(d, ["jazz"], "jazz"),
  },
  {
    phrases: ["איטלקי", "italian"],
    apply: (d) => {
      addSlugs(d, ["italian-classics"], "איטלקי");
      addConcept(d, ["italian"], "איטלקי");
    },
  },
  {
    phrases: ["ים", "חוף", "beach"],
    apply: (d) => addConcept(d, ["beach", "sea", "coast"], "ים"),
  },
  {
    phrases: ["retail", "חנות"],
    apply: (d) => setBusiness(d, "RETAIL", "retail"),
  },
  {
    phrases: ["office", "משרד"],
    apply: (d) => setBusiness(d, "OFFICE", "office"),
  },
  {
    phrases: ["young", "צעירים"],
    apply: (d) => addAudience(d, ["young"], "young"),
  },
  {
    phrases: ["תיירים", "tourist", "tourists"],
    apply: (d) => addAudience(d, ["tourist"], "תיירים"),
  },
  {
    phrases: ["premium", "פרימיום"],
    apply: (d) => addAudience(d, ["premium"], "premium"),
  },
  {
    phrases: ["business", "עסקים"],
    apply: (d) => addAudience(d, ["business"], "business"),
  },
];

function applyPhraseMap(normalized: string, d: ParseDraft): void {
  const entries = [...PHRASE_MAP].sort((a, b) => {
    const la = Math.max(...a.phrases.map((p) => p.length));
    const lb = Math.max(...b.phrases.map((p) => p.length));
    return lb - la;
  });

  for (const entry of entries) {
    for (const phrase of entry.phrases) {
      const p = normalizeSmartQueryText(phrase);
      if (p.length >= 2 && normalized.includes(p)) {
        entry.apply(d);
        break;
      }
    }
  }
}

function finalizeDraft(trimmedRaw: string, normalized: string, d: ParseDraft): ParsedSmartCatalogQuery {
  const coarseDaypart: DaypartSlug = d.coarseDaypart ?? "dinner";
  let vibeSegment: DaypartSegment = d.vibeSegment ?? (coarseDaypart as DaypartSegment);

  if (!d.vibeSegment) {
    const map: Record<DaypartSlug, DaypartSegment> = {
      morning: "morning",
      lunch: "lunch",
      dinner: "dinner",
      night: "night",
    };
    vibeSegment = map[coarseDaypart];
  }

  return {
    rawQuery: trimmedRaw,
    normalizedForMatch: normalized,
    businessType: d.businessType,
    coarseDaypart,
    vibeSegment,
    moodHints: [...d.moodHints],
    energyHint: d.energyHint,
    styleTaxonomySlugs: [...d.styleTaxonomySlugs],
    audienceHints: [...d.audienceHints],
    conceptTags: [...d.conceptTags],
    matchedPhrases: [...d.matchedPhrases],
  };
}

/**
 * Parse a free-text business-music query into structured hints.
 */
export function parseSmartCatalogQuery(rawQuery: string): ParsedSmartCatalogQuery {
  const trimmed = rawQuery.trim();
  const normalized = normalizeSmartQueryText(trimmed);

  const d: ParseDraft = {
    businessType: null,
    coarseDaypart: null,
    vibeSegment: null,
    moodHints: new Set(),
    energyHint: null,
    styleTaxonomySlugs: new Set(),
    audienceHints: new Set(),
    conceptTags: new Set(),
    matchedPhrases: new Set(),
  };

  if (normalized.length >= 1) {
    applyPhraseMap(normalized, d);
  }

  return finalizeDraft(trimmed, normalized, d);
}
