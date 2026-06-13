/**

 * DJ Intent Dictionary — shared product-language layer for DJ Creator,

 * PlaylistPro Local Catalog, and SyncBiz URL Catalog.

 *

 * User language → existing MusicTaxonomyTag slugs (authoritative).

 * localSearchTerms are for PlaylistPro folder/comment/path matching only.

 */



export type DjIntentSignalCategory =

  | "decade"

  | "genre_style"

  | "mood_energy"

  | "quality_programming"

  | "region_language"

  | "business_context";



/** Local snapshot search group ids (PlaylistPro Local Catalog). */

export type DjIntentLocalGroupId =

  | "mediterranean"

  | "mood_calm"

  | "rock"

  | "pop"

  | "decade_1980"

  | "decade_1970"

  | "selected"

  | "hits"

  | "israeli"

  | "jazz_family"

  | "general";



export type DjIntentSignal = {

  id: string;

  category: DjIntentSignalCategory;

  labelEn: string;

  labelHe?: string;

  aliases: string[];

  taxonomySlugs: string[];

  vendorTaxonomySlugs?: string[];

  localSearchTerms?: string[];

  commentTags?: string[];

  operatorOnly?: boolean;

};



export type DjIntentLocalGroupDefinition = {

  id: DjIntentLocalGroupId;

  label: string;

  category: DjIntentSignalCategory;

  detectPhrases: string[];

  detectLatinWords?: string[];

  detectPatternSources?: string[];

  taxonomySlugs: string[];

  vendorTaxonomySlugs?: string[];

  localSearchTerms: string[];

  /**
   * Pilot strictness rule for region/genre exclusivity.
   *
   * When THIS group is detected in the user's prompt but one of the listed
   * sibling groups is NOT, AI playlist build rejects rows whose taxonomy
   * (catalog) or fields (local genre / comment / path / artist / album / title)
   * place them in the absent sibling group. Prevents "ישראלי" prompts from
   * pulling in Mediterranean/Mizrahi rows when the user did not ask for them.
   *
   * Example: `israeli` excludes `["mediterranean", "jazz_family"]` so a query
   * like "ישראלי רגוע להיטים" yields pure Israeli pop/rock and not mizrahi
   * or Israeli-jazz rows, while "ישראלי מזרחי" leaves both groups active and
   * lifts the exclusion.
   */
  excludesGroupsWhenAbsent?: DjIntentLocalGroupId[];

};



export type DjIntentCommentTagMapping = {

  taxonomySlugs: string[];

  vendorTaxonomySlugs?: string[];

  localSearchTerms?: string[];

  operatorOnly?: boolean;

};



export const DJ_INTENT_COMMENT_TAG_TAXONOMY: Readonly<Record<string, DjIntentCommentTagMapping>> = {

  SELECTED: { taxonomySlugs: ["selected"], localSearchTerms: ["selected", "מובחרים", "נבחרים", "מומלצים"] },

  HIT: { taxonomySlugs: ["hits"], localSearchTerms: ["hit", "hits", "להיט", "להיטים"] },

  EASY: {

    taxonomySlugs: ["chill-mellow", "low-energy"],

    localSearchTerms: ["easy", "calm", "soft", "רגוע", "שקט"],

  },

  GENERAL: { taxonomySlugs: [], localSearchTerms: ["general", "כללי"] },

  "ROCK-EASY": {

    taxonomySlugs: ["classic-rock", "soft-rock", "chill-mellow", "low-energy"],

    localSearchTerms: ["rock easy", "rock-easy", "rock/easy"],

  },

  BACKGROUND: { taxonomySlugs: ["lounge"], localSearchTerms: ["background", "רקע"] },

  LOUNGE: { taxonomySlugs: ["lounge"], localSearchTerms: ["lounge", "לאונג"] },

  DINNER: { taxonomySlugs: ["dinner"], localSearchTerms: ["dinner"] },

  PREMIUM: { taxonomySlugs: ["elegant", "sophisticated"], localSearchTerms: ["premium"] },

  ISRAELI: {

    taxonomySlugs: ["israeli-hits", "ethnic-israeli"],

    localSearchTerms: ["israeli", "ישראלי", "hebrew", "עברית"],

  },

  MEDITERRANEAN: {

    taxonomySlugs: ["mediterranean-pop", "oriental", "middle-eastern-beats"],

    localSearchTerms: ["mediterranean", "mizrahi", "oriental", "מזרחי", "ים תיכוני"],

  },

  LOLA: { taxonomySlugs: [], localSearchTerms: ["lola"], operatorOnly: true },

  BENZ: { taxonomySlugs: [], localSearchTerms: ["benz"], operatorOnly: true },

  GAZIT: { taxonomySlugs: [], localSearchTerms: ["gazit"], operatorOnly: true },

};



export const DJ_INTENT_SIGNALS: readonly DjIntentSignal[] = [

  {

    id: "quality.selected",

    category: "quality_programming",

    labelEn: "Selected",

    labelHe: "מובחרים",

    aliases: ["מובחרים", "נבחרים", "מומלצים", "selected", "select", "chosen", "best", "recommended"],

    taxonomySlugs: ["selected"],

    localSearchTerms: ["selected", "select", "מובחרים", "נבחרים", "מומלצים", "chosen", "recommended"],

    commentTags: ["SELECTED"],

  },

  {

    id: "quality.hit",

    category: "quality_programming",

    labelEn: "Hits",

    labelHe: "להיטים",

    aliases: ["להיטים", "להיט", "hits", "hit", "popular", "chart", "top"],

    taxonomySlugs: ["hits"],

    localSearchTerms: ["hits", "hit", "להיטים", "להיט", "popular", "chart", "top"],

    commentTags: ["HIT"],

  },

  {

    id: "mood.easy",

    category: "mood_energy",

    labelEn: "Easy / Calm",

    labelHe: "רגוע",

    aliases: ["רגוע", "שקט", "calm", "relax", "slow", "chill", "mellow", "easy", "soft", "quiet", "low energy"],

    taxonomySlugs: ["chill-mellow", "relaxing", "low-energy"],

    localSearchTerms: ["easy", "calm", "soft", "mellow", "chill", "relax", "רגוע", "שקט", "low energy", "easy listening", "slow"],

    commentTags: ["EASY"],

  },

  {

    id: "genre.mediterranean",

    category: "region_language",

    labelEn: "Mediterranean / Mizrahi",

    labelHe: "ים תיכוני",

    aliases: ["ים תיכוני", "ים תיכון", "mediterranean", "mizrahi", "oriental", "מזרחי", "middle eastern"],

    taxonomySlugs: ["mediterranean-pop", "oriental", "middle-eastern-beats"],

    vendorTaxonomySlugs: [

      "playlist-pro-oriental-general",

      "playlist-pro-oriental-easy-acid",

      "playlist-pro-oriental-electronic",

    ],

    localSearchTerms: [

      "ים תיכוני",

      "ים תיכון",

      "mediterranean",

      "mizrahi",

      "oriental",

      "מזרחי",

      "middle eastern",

      "israeli mediterranean",

      "oriental pop",

      "mizrahi pop",

    ],

    commentTags: ["MEDITERRANEAN"],

  },

  {

    id: "region.israeli",

    category: "region_language",

    labelEn: "Israeli / Hebrew",

    labelHe: "ישראלי",

    aliases: ["ישראלי", "ישראלים", "ישראל", "עברית", "israeli", "israel", "hebrew", "zion"],

    taxonomySlugs: ["israeli-hits", "ethnic-israeli", "israeli-acoustic"],

    vendorTaxonomySlugs: [

      "playlist-pro-israeli-kelali",

      "playlist-pro-israeli-regua",

      "playlist-pro-israeli-sheket",

      "playlist-pro-israeli-rock-1990",

    ],

    localSearchTerms: ["israeli", "israel", "hebrew", "ישראלי", "ישראלים", "ישראל", "עברית", "zion"],

    commentTags: ["ISRAELI"],

  },

  {

    id: "decade.1980s",

    category: "decade",

    labelEn: "1980s",

    labelHe: "שנות ה-80",

    aliases: ["1980", "1980s", "80s", "eighties", "אייטיז", "שנות ה-80", "שנות השמונים"],

    taxonomySlugs: ["80s-new-wave-pop"],

    vendorTaxonomySlugs: [

      "playlist-pro-1980-s-easy",

      "playlist-pro-1980-s-general",

      "playlist-pro-1980-s-pop",

      "playlist-pro-rock-1980-s-easy",

      "playlist-pro-rock-1980-s-general",

      "playlist-pro-slow-and-ballads-1980-s",

    ],

    localSearchTerms: ["1980", "1980s", "80s", "eighties", "אייטיז", "שנות ה-80", "שנות השמונים", "1980's"],

  },

  {

    id: "decade.1970s",

    category: "decade",

    labelEn: "1970s",

    labelHe: "שנות ה-70",

    aliases: ["1970", "1970s", "70s", "seventies", "סבנטיז", "שנות ה-70", "שנות השבעים"],

    taxonomySlugs: ["70s-disco-and-funk"],

    vendorTaxonomySlugs: [

      "playlist-pro-1970-s-easy",

      "playlist-pro-1970-s-general",

      "playlist-pro-1970-s-pop-and-disco",

      "playlist-pro-rock-1970-s-easy",

      "playlist-pro-rock-1970-s-general",

      "playlist-pro-rock-1970-s-progressive",

    ],

    localSearchTerms: ["1970", "1970s", "70s", "seventies", "סבנטיז", "שנות ה-70", "שנות השבעים", "1970's"],

  },

  {

    id: "genre.rock",

    category: "genre_style",

    labelEn: "Rock",

    labelHe: "רוק",

    aliases: ["rock", "רוק", "hard rock", "classic rock", "rocknroll", "rock n roll"],

    taxonomySlugs: ["classic-rock", "soft-rock", "israeli-rock"],

    vendorTaxonomySlugs: [

      "playlist-pro-rock-1970-s-easy",

      "playlist-pro-rock-1970-s-general",

      "playlist-pro-rock-1980-s-easy",

      "playlist-pro-rock-1980-s-general",

      "playlist-pro-rock-1990-s-easy",

      "playlist-pro-rock-1990-s-general",

      "playlist-pro-rock-2000-s-easy",

      "playlist-pro-rock-2000-s-general",

    ],

    localSearchTerms: ["rock", "רוק", "hard rock", "classic rock", "rocknroll", "rock n roll"],

    commentTags: ["ROCK-EASY"],

  },

  {

    id: "genre.jazz",

    category: "genre_style",

    labelEn: "Jazz",

    labelHe: "ג׳אז",

    aliases: ["jazz", "ג׳אז", "ג'אז", "גאז"],

    taxonomySlugs: ["jazz", "smooth-jazz", "swing", "acid-jazz", "gipsy-jazz"],

    vendorTaxonomySlugs: [

      "playlist-pro-jazz-general",

      "playlist-pro-jazz-smooth",

      "playlist-pro-jazz-swing",

    ],

    localSearchTerms: ["jazz", "smooth jazz", "swing", "ג׳אז", "ג'אז", "גאז"],

  },

  {

    id: "genre.pop",

    category: "genre_style",

    labelEn: "Pop",

    labelHe: "פופ",

    aliases: ["pop", "פופ"],

    taxonomySlugs: ["soft-pop", "indie-pop"],

    vendorTaxonomySlugs: [

      "playlist-pro-mtv-pop-general",

      "playlist-pro-mtv-pop-easy",

      "playlist-pro-1980-s-pop",

      "playlist-pro-1990-s-dance",

    ],

    localSearchTerms: ["pop", "פופ"],

  },

  {

    id: "mood.high_energy",

    category: "mood_energy",

    labelEn: "High energy",

    labelHe: "חזק",

    aliases: ["חזק", "קצבי", "high energy", "energy", "dance", "upbeat"],

    taxonomySlugs: ["high-energy", "groovy"],

    localSearchTerms: ["high energy", "energy", "dance", "upbeat", "peak", "קצבי", "חזק"],

  },

  {

    id: "quality.background",

    category: "quality_programming",

    labelEn: "Background",

    labelHe: "רקע",

    aliases: ["רקע", "background"],

    taxonomySlugs: ["lounge"],

    localSearchTerms: ["background", "רקע"],

    commentTags: ["BACKGROUND"],

  },

  {

    id: "business.restaurant",

    category: "business_context",

    labelEn: "Restaurant",

    labelHe: "מסעדה",

    aliases: ["מסעדה", "restaurant"],

    taxonomySlugs: ["restaurant"],

    localSearchTerms: ["restaurant", "מסעדה"],

  },

  {

    id: "business.cafe",

    category: "business_context",

    labelEn: "Cafe",

    labelHe: "קפה",

    aliases: ["קפה", "cafe", "coffee", "בית קפה"],

    taxonomySlugs: ["cafe"],

    localSearchTerms: ["cafe", "coffee", "קפה", "בית קפה"],

  },

  {

    id: "business.hotel",

    category: "business_context",

    labelEn: "Hotel",

    labelHe: "מלון",

    aliases: ["מלון", "hotel", "lobby", "לובי"],

    taxonomySlugs: ["hotel"],

    localSearchTerms: ["hotel", "מלון", "lobby", "לובי"],

  },

  {

    id: "daypart.lunch",

    category: "business_context",

    labelEn: "Lunch",

    labelHe: "צהריים",

    aliases: ["צהריים", "lunch", "noon"],

    taxonomySlugs: ["lunch"],

    localSearchTerms: ["lunch", "צהריים", "noon"],

  },

  {

    id: "daypart.dinner",

    category: "business_context",

    labelEn: "Dinner / Evening",

    labelHe: "ערב",

    aliases: ["ערב", "dinner", "evening"],

    taxonomySlugs: ["dinner"],

    localSearchTerms: ["dinner", "evening", "ערב"],

  },

  {

    id: "mood.premium",

    category: "mood_energy",

    labelEn: "Premium / Elegant",

    labelHe: "יוקרתי",

    aliases: ["יוקרתי", "premium", "elegant", "luxury", "classy"],

    taxonomySlugs: ["elegant", "sophisticated"],

    localSearchTerms: ["premium", "יוקרתי", "elegant", "luxury"],

    commentTags: ["PREMIUM"],

  },

  {

    id: "operator.lola",

    category: "business_context",

    labelEn: "LOLA (operator)",

    aliases: ["lola"],

    taxonomySlugs: [],

    localSearchTerms: ["lola"],

    commentTags: ["LOLA"],

    operatorOnly: true,

  },

  {

    id: "operator.benz",

    category: "business_context",

    labelEn: "BENZ (operator)",

    aliases: ["benz"],

    taxonomySlugs: [],

    localSearchTerms: ["benz"],

    commentTags: ["BENZ"],

    operatorOnly: true,

  },

  {

    id: "operator.gazit",

    category: "business_context",

    labelEn: "GAZIT (operator)",

    aliases: ["gazit"],

    taxonomySlugs: [],

    localSearchTerms: ["gazit"],

    commentTags: ["GAZIT"],

    operatorOnly: true,

  },

] as const;



export const DJ_INTENT_COMMENT_TAGS: readonly string[] = [

  "SELECTED",

  "HIT",

  "EASY",

  "GENERAL",

  "ROCK-EASY",

  "BACKGROUND",

  "LOUNGE",

  "DINNER",

  "PREMIUM",

  "ISRAELI",

  "MEDITERRANEAN",

];



export const DJ_INTENT_OPERATOR_COMMENT_TAGS: readonly string[] = ["LOLA", "BENZ", "GAZIT"];



export const DJ_INTENT_TOKEN_EXPANSIONS: Readonly<Record<string, readonly string[]>> = {

  ישראלי: ["israeli", "israel", "hebrew", "עברית", "ישראל", "zion"],

  ישראל: ["israel", "israeli", "hebrew", "ישראלי"],

  עברית: ["hebrew", "israeli", "ישראלי"],

  israeli: ["ישראלי", "ישראל", "hebrew", "israel"],

  israel: ["ישראל", "ישראלי", "hebrew"],

  hebrew: ["עברית", "ישראלי", "israeli"],

  מובחרים: ["selected", "select", "מומלצים", "נבחרים", "chosen", "best"],

  מומלצים: ["selected", "recommended", "מובחרים", "נבחרים"],

  נבחרים: ["selected", "מובחרים", "מומלצים", "chosen"],

  selected: ["מובחרים", "נבחרים", "מומלצים", "select"],

  select: ["selected", "מובחרים"],

  להיטים: ["hits", "hit", "popular", "chart", "top", "להיט"],

  להיט: ["hit", "hits", "להיטים"],

  hit: ["להיט", "hits", "להיטים"],

  hits: ["להיטים", "hit", "popular"],

  רגוע: ["calm", "relax", "slow", "chill", "mellow", "easy", "lounge", "soft", "שקט"],

  שקט: ["calm", "quiet", "easy", "רגוע", "soft"],

  rock: ["רוק", "hard rock", "classic rock", "rocknroll"],

  רוק: ["rock", "hard rock"],

  jazz: ["smooth jazz", "swing", "acid jazz", "ג׳אז", "ג'אז", "גאז"],

  "ג׳אז": ["jazz", "smooth jazz", "swing", "acid jazz"],

  "ג'אז": ["jazz", "smooth jazz", "swing", "acid jazz"],

  גאז: ["jazz", "smooth jazz", "swing", "acid jazz"],

  pop: ["פופ"],

  פופ: ["pop"],

  easy: ["easy listening", "soft", "mellow", "light", "רגוע", "chill", "calm"],

  ים: ["mediterranean", "mizrahi", "oriental", "middle eastern", "ים תיכוני"],

  תיכוני: ["mediterranean", "mizrahi", "oriental", "ים תיכוני"],

  mediterranean: ["ים תיכוני", "mizrahi", "oriental", "middle eastern", "מזרחי"],

  mizrahi: ["מזרחי", "oriental", "mediterranean", "ים תיכוני"],

  oriental: ["מזרחי", "mizrahi", "mediterranean"],

  מזרחי: ["mizrahi", "oriental", "mediterranean", "ים תיכוני"],

  "1980": ["1980s", "80s", "eighties", "אייטיז", "שנות ה-80", "שנות השמונים"],

  "1980s": ["1980", "80s", "אייטיז"],

  "1970": ["1970s", "70s", "seventies", "שנות ה-70", "שנות השבעים"],

  "1970s": ["1970", "70s"],

  אייטיז: ["1980", "1980s", "80s"],

  סבנטיז: ["1970", "1970s", "70s"],

  "80s": ["1980", "1980s", "אייטיז"],

  "70s": ["1970", "1970s"],

};



export const DJ_INTENT_MEDITERRANEAN_PHRASE_BOOST_TERMS: readonly string[] = [

  "mediterranean",

  "mizrahi",

  "oriental",

  "מזרחי",

];



export const DJ_INTENT_LOCAL_GROUP_DEFINITIONS: readonly DjIntentLocalGroupDefinition[] = [

  {

    id: "mediterranean",

    label: "Mediterranean/Mizrahi",

    category: "region_language",

    detectPhrases: ["ים תיכוני", "ים תיכון", "mediterranean", "mizrahi", "oriental", "מזרחי"],

    taxonomySlugs: ["mediterranean-pop", "oriental", "middle-eastern-beats"],

    vendorTaxonomySlugs: ["playlist-pro-oriental-general", "playlist-pro-oriental-easy-acid"],

    localSearchTerms: [

      "ים תיכוני",

      "ים תיכון",

      "mediterranean",

      "mizrahi",

      "oriental",

      "מזרחי",

      "middle eastern",

      "israeli mediterranean",

      "oriental pop",

      "mizrahi pop",

    ],

  },

  {

    id: "rock",

    label: "Rock",

    category: "genre_style",

    detectPhrases: ["rock", "רוק", "hard rock", "classic rock"],

    detectLatinWords: ["rock"],

    taxonomySlugs: ["classic-rock", "soft-rock", "israeli-rock"],

    vendorTaxonomySlugs: ["playlist-pro-rock-1980-s-easy", "playlist-pro-rock-1990-s-easy"],

    localSearchTerms: ["rock", "רוק", "hard rock", "classic rock", "rocknroll", "rock n roll"],

  },

  {

    id: "mood_calm",

    label: "Calm/Easy",

    category: "mood_energy",

    detectPhrases: ["רגוע", "שקט", "calm", "soft", "mellow", "chill", "relax", "lounge", "slow"],

    detectLatinWords: ["easy"],

    taxonomySlugs: ["chill-mellow", "relaxing", "low-energy"],

    localSearchTerms: [

      "easy",

      "calm",

      "soft",

      "mellow",

      "chill",

      "relax",

      "lounge",

      "רגוע",

      "שקט",

      "low energy",

      "easy listening",

      "slow",

    ],

  },

  {

    id: "decade_1980",

    label: "1980s",

    category: "decade",

    detectPhrases: ["1980", "1980s", "80s", "אייטיז", "שנות ה-80", "שנות השמונים"],

    detectPatternSources: ["שנות[\\s-]*ה?[\\s-]*?(80|שמונים)"],

    taxonomySlugs: ["80s-new-wave-pop"],

    vendorTaxonomySlugs: [

      "playlist-pro-1980-s-easy",

      "playlist-pro-1980-s-general",

      "playlist-pro-1980-s-pop",

      "playlist-pro-rock-1980-s-easy",

    ],

    localSearchTerms: ["1980", "1980s", "80s", "eighties", "אייטיז", "שנות ה-80", "שנות השמונים", "1980's"],

  },

  {

    id: "decade_1970",

    label: "1970s",

    category: "decade",

    detectPhrases: ["1970", "1970s", "70s", "סבנטיז", "שנות ה-70", "שנות השבעים"],

    detectPatternSources: ["שנות[\\s-]*ה?[\\s-]*?(70|שבעים)"],

    taxonomySlugs: ["70s-disco-and-funk"],

    vendorTaxonomySlugs: [

      "playlist-pro-1970-s-easy",

      "playlist-pro-1970-s-general",

      "playlist-pro-1970-s-pop-and-disco",

    ],

    localSearchTerms: ["1970", "1970s", "70s", "seventies", "סבנטיז", "שנות ה-70", "שנות השבעים", "1970's"],

  },

  {

    id: "selected",

    label: "Selected",

    category: "quality_programming",

    detectPhrases: ["מובחרים", "נבחרים", "מומלצים", "selected", "chosen", "best"],

    detectLatinWords: ["selected", "select"],

    taxonomySlugs: ["selected"],

    localSearchTerms: ["selected", "select", "מובחרים", "נבחרים", "מומלצים", "chosen", "recommended"],

  },

  {

    id: "hits",

    label: "Hits",

    category: "quality_programming",

    detectPhrases: ["להיטים", "להיט", "hits", "hit", "popular", "chart", "top"],

    taxonomySlugs: ["hits"],

    localSearchTerms: ["hits", "hit", "להיטים", "להיט", "popular", "chart", "top"],

  },

  {

    id: "israeli",

    label: "Israeli",

    category: "region_language",

    detectPhrases: ["ישראלי", "ישראלים", "israeli", "hebrew", "עברית", "ישראל", "israel"],

    taxonomySlugs: ["israeli-hits", "ethnic-israeli", "israeli-acoustic"],

    vendorTaxonomySlugs: ["playlist-pro-israeli-kelali", "playlist-pro-israeli-regua", "playlist-pro-israeli-sheket"],

    localSearchTerms: ["israeli", "israel", "hebrew", "ישראלי", "ישראל", "עברית", "zion"],

    // ישראלי == Israeli mainstream (pop / rock / acoustic).
    // The user must say "ים תיכוני" / "mediterranean" / "mizrahi" to opt in
    // to oriental-styled rows, and "jazz" to opt in to Israeli jazz.
    excludesGroupsWhenAbsent: ["mediterranean", "jazz_family"],

  },

  {

    id: "jazz_family",

    label: "Jazz",

    category: "genre_style",

    detectPhrases: ["jazz", "ג׳אז", "ג'אז", "גאז"],

    detectLatinWords: ["jazz"],

    taxonomySlugs: ["jazz", "smooth-jazz", "swing", "acid-jazz", "gipsy-jazz"],

    vendorTaxonomySlugs: ["playlist-pro-jazz-general", "playlist-pro-jazz-smooth", "playlist-pro-jazz-swing"],

    localSearchTerms: ["jazz", "smooth jazz", "swing", "ג׳אז", "ג'אז", "גאז"],

  },

];



export function getDjIntentLocalGroupHaystackTerms(def: DjIntentLocalGroupDefinition): string[] {

  return [...def.localSearchTerms];

}



export function getDjIntentTaxonomySlugs(input: {

  taxonomySlugs: string[];

  vendorTaxonomySlugs?: string[];

}): string[] {

  return [...input.taxonomySlugs, ...(input.vendorTaxonomySlugs ?? [])];

}



export function getProductDjIntentSignals(): DjIntentSignal[] {

  return DJ_INTENT_SIGNALS.filter((s) => !s.operatorOnly);

}



export function getDjIntentSignalById(id: string): DjIntentSignal | undefined {

  return DJ_INTENT_SIGNALS.find((s) => s.id === id);

}



export function getDjIntentLocalGroupDefinition(id: DjIntentLocalGroupId): DjIntentLocalGroupDefinition | undefined {

  return DJ_INTENT_LOCAL_GROUP_DEFINITIONS.find((g) => g.id === id);

}



export function resolveCommentTagTaxonomy(tag: string): DjIntentCommentTagMapping | undefined {

  return DJ_INTENT_COMMENT_TAG_TAXONOMY[tag.trim().toUpperCase()];

}


