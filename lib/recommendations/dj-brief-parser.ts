/**
 * DJ Creator — deterministic free-text/voice → brief parser.
 *
 * Phase 1 of the DJ-Creator-as-agent strategy: turn what the owner TYPES or SAYS
 * ("קפה בוקר רגוע בלי עברית", "80s funk for happy hour") into the same structured
 * picks the guided wizard produces — business / daypart / vibe / style + an avoid
 * list — so the full engine engages (daypart API, business matrix, fit-rules),
 * not just a raw keyword append. No LLM/API key required; works offline, and the
 * SAME parser handles a speech transcript. Upgradeable to an LLM later behind the
 * same return shape.
 *
 * The ids returned here MUST match the bubble ids in `dj-creator-ai-shell.tsx`.
 */

export type DjBriefParse = {
  businessId: string | null;
  daypartId: string | null;
  vibeId: string | null;
  styleId: string | null;
  /** Taxonomy/avoid intents, e.g. "hebrew", "explicit", "vocals". */
  avoid: string[];
  /** Words that didn't map to a pick — still useful appended to the catalog query. */
  remainder: string;
  /** True if we recognised at least one dimension. */
  matched: boolean;
};

type Rule = { id: string; terms: string[] };

/** Longest term first so "בית קפה" wins over "קפה", "happy hour" over "happy". */
function matchFirst(hay: string, rules: Rule[]): { id: string; hit: string } | null {
  let best: { id: string; hit: string; len: number } | null = null;
  for (const r of rules) {
    for (const term of r.terms) {
      if (hay.includes(term) && (!best || term.length > best.len)) {
        best = { id: r.id, hit: term, len: term.length };
      }
    }
  }
  return best ? { id: best.id, hit: best.hit } : null;
}

const BUSINESS: Rule[] = [
  { id: "cafe", terms: ["בית קפה", "בית-קפה", "קפה", "cafe", "café", "coffee"] },
  { id: "restaurant", terms: ["מסעדה", "מסעדת", "restaurant", "dining", "bistro", "eatery"] },
  { id: "hotel", terms: ["מלון", "לובי", "hotel", "lobby", "reception"] },
  { id: "spa", terms: ["ספא", "spa", "wellness", "עיסוי", "massage", "טיפולים"] },
  { id: "gym", terms: ["חדר כושר", "כושר", "gym", "fitness", "workout", "אימון", "קרוספיט", "crossfit"] },
  { id: "bar", terms: ["מועדון", "נייטקלאב", "nightclub", "בר", "bar", "pub", "פאב", "club"] },
];

const DAYPART: Rule[] = [
  { id: "morning", terms: ["בוקר", "morning", "breakfast", "ארוחת בוקר"] },
  { id: "lunch", terms: ["צהריים", "צהרים", "lunch", "ארוחת צהריים", "midday", "noon"] },
  { id: "afternoon", terms: ["אחר הצהריים", "אחה״צ", "אחהצ", "afternoon"] },
  { id: "evening", terms: ["ערב", "evening", "dinner", "ארוחת ערב", "happy hour", "האפי האוור"] },
  { id: "night", terms: ["לילה", "night", "late night", "אחרי חצות"] },
];

const VIBE: Rule[] = [
  { id: "calm", terms: ["רגוע", "רגועה", "שקט", "שקטה", "נינוח", "calm", "peaceful", "relaxed", "mellow", "quiet"] },
  { id: "romantic", terms: ["רומנטי", "רומנטית", "אינטימי", "romantic", "intimate", "date"] },
  { id: "premium", terms: ["פרימיום", "יוקרתי", "יוקרה", "אלגנטי", "מתוחכם", "premium", "elegant", "sophisticated", "luxury", "upscale"] },
  { id: "sexy", terms: ["סקסי", "חושני", "קצבי לערב", "sexy", "sultry", "groove"] },
  { id: "happy", terms: ["שמח", "שמחה", "עליז", "כיף", "happy", "upbeat", "cheerful", "fun", "feel good"] },
  { id: "energy", terms: ["אנרגיה גבוהה", "אנרגטי", "אנרגטית", "קצבי", "high energy", "energetic", "pumping", "intense", "hype"] },
];

/** Style ids MUST match STYLE_BUBBLES ids in the shell so a matched style shows as selected. */
const STYLE: Rule[] = [
  { id: "mediterranean", terms: ["ים תיכוני", "ים-תיכוני", "mediterranean"] },
  { id: "israeli", terms: ["ישראלי", "ישראלית", "עברי", "israeli", "hebrew"] },
  { id: "mizrahi", terms: ["מזרחי", "מזרחית", "mizrahi", "oriental", "middle eastern"] },
  { id: "greek-italian", terms: ["יווני", "איטלקי", "greek", "italian"] },
  { id: "oldies", terms: ["אולדיז", "רטרו", "oldies", "retro", "נוסטלגי", "nostalgic"] },
  { id: "rock", terms: ["רוק", "rock"] },
  { id: "funk-soul", terms: ["פאנק", "סול", "דיסקו", "funk", "soul", "disco"] },
  { id: "afro", terms: ["אפרו", "afro", "afrobeat"] },
  { id: "pop-hits", terms: ["להיטים", "פופ", "hits", "pop"] },
  { id: "lounge", terms: ["לאונג", "lounge"] },
  { id: "bossa", terms: ["בוסה", "לטיני", "bossa", "latin", "סלסה", "salsa"] },
  { id: "jazz", terms: ["גאז", "ג'אז", "jazz"] },
  { id: "chill", terms: ["צ'יל", "ציל", "chill", "downtempo", "ambient", "לו פיי", "lo-fi", "lofi"] },
];

/** Hebrew genre words WITHOUT a dedicated style bubble → English query keywords for the
 *  remainder (bubble-covered genres are handled by STYLE above, so they're not repeated here). */
const STYLE_TO_QUERY: Record<string, string> = {
  "האוס": "house", "טכנו": "techno", "טראנס": "trance", "רגאיי": "reggae",
  "אר אנד בי": "rnb", "היפ הופ": "hip hop", "ראפ": "rap", "קלאסי": "classical",
  "אקוסטי": "acoustic", "קאנטרי": "country", "בלוז": "blues", "אלקטרו": "electronic",
};

const AVOID: Rule[] = [
  { id: "hebrew", terms: ["בלי עברית", "לא עברית", "no hebrew", "without hebrew", "לועזית בלבד"] },
  { id: "explicit", terms: ["בלי בוטה", "לא בוטה", "נקי", "no explicit", "clean only", "family friendly"] },
  { id: "vocals", terms: ["בלי מילים", "בלי שירה", "אינסטרומנטלי", "no vocals", "instrumental", "no lyrics"] },
  { id: "english", terms: ["בלי אנגלית", "no english", "עברית בלבד"] },
];

/** Normalise so matching is case/quote-insensitive. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[’‘'`"]/g, "'").replace(/\s+/g, " ").trim();
}

export function parseDjBrief(input: string): DjBriefParse {
  const raw = (input ?? "").trim();
  const hay = norm(raw);
  if (!hay) {
    return { businessId: null, daypartId: null, vibeId: null, styleId: null, avoid: [], remainder: "", matched: false };
  }

  const business = matchFirst(hay, BUSINESS);
  const daypart = matchFirst(hay, DAYPART);
  const vibe = matchFirst(hay, VIBE);
  const style = matchFirst(hay, STYLE);

  const avoid: string[] = [];
  const avoidHits: string[] = [];
  for (const r of AVOID) {
    for (const t of r.terms) {
      const nt = norm(t);
      if (hay.includes(nt)) {
        if (!avoid.includes(r.id)) avoid.push(r.id);
        avoidHits.push(nt);
      }
    }
  }

  // Build the remainder: the original text minus the phrases we consumed, plus any
  // Hebrew genre words translated to English keywords so the catalog search sees them.
  let remainder = hay;
  for (const hit of [business?.hit, daypart?.hit, vibe?.hit, style?.hit, ...avoidHits].filter(Boolean) as string[]) {
    remainder = remainder.split(hit).join(" ");
  }
  const genreKeywords: string[] = [];
  for (const [he, en] of Object.entries(STYLE_TO_QUERY)) {
    if (hay.includes(he)) {
      genreKeywords.push(en);
      remainder = remainder.split(he).join(" ");
    }
  }
  remainder = [remainder.replace(/\s+/g, " ").trim(), ...genreKeywords].filter(Boolean).join(" ").trim();

  const matched = Boolean(business || daypart || vibe || style || avoid.length || genreKeywords.length);
  return {
    businessId: business?.id ?? null,
    daypartId: daypart?.id ?? null,
    vibeId: vibe?.id ?? null,
    styleId: style?.id ?? null,
    avoid,
    remainder,
    matched,
  };
}
