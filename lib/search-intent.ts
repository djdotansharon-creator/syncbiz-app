/**
 * AI-style natural language parsing for search queries.
 * Supports: "most views", "live performance", date range, etc.
 * Used for both typed and voice search.
 */

const SORT_BY_VIEWS_KEYWORDS = [
  "most played", "most viewed", "most popular", "most views", "highest views",
  "top song", "top hit", "best song", "popular song", "most streamed", "most listened",
  "number one", "#1 song", "biggest hit", "with most views", "by views",
  "הכי הרבה צפיות", "הכי הרבה צפים", "רוב הצפיות", "הכי צפיות", "לפי צפיות",
  "הכי מושמע", "הכי מנוגן", "הכי נראה", "הכי פופולרי", "הכי מושמעום", "הכי מושמעים",
  "עם הכי הרבה צפיות", "עם הכי הרבה צפים",
  "השיר הכי מושמע", "השיר הכי מנוגן", "השיר הכי נראה", "השיר הכי פופולרי", "השיר עם הכי הרבה צפיות",
  "השיר המושמע ביותר", "השיר המנוגן ביותר", "השיר הנראה ביותר", "הלהיט הכי גדול",
  "השיר מספר 1", "השיר הנשמע ביותר",
  "ההופעה הכי הרבה צפיות", "ההופעה הכי מושמעת",
  "הסטים הכי מושמעים", "הסטים הכי צפים", "סטים עם הכי הרבה צפיות",
] as const;

const SETS_MIX_KEYWORDS = [
  "סטים", "סט", "mix", "מיקס", "מיקסים", "dj set", "די ג'יי", "דיג'יי",
  "full set", "live set", "sets",
] as const;

/** Genre terms that improve YouTube search when translated to English */
const GENRE_MAP: Record<string, string> = {
  "אפרו": "afrobeat",
  "אפרוביט": "afrobeat",
  "אפריקאי": "afro",
  "מזרחי": "mizrahi",
  "ים תיכוני": "mediterranean",
  "טראנס": "trance",
  "האוס": "house",
  "טכנו": "techno",
  "רגאיי": "reggae",
  "דאבסטפ": "dubstep",
};

const LIVE_PERFORMANCE_KEYWORDS = [
  "live", "live performance", "live concert", "live show", "in concert",
  "הופעה חיה", "הופעה בקיסריה", "הופעה באולם", "תמצא לי הופעה", "מצא הופעה",
  "הופעה חיה של",
] as const;

export type ParsedSearch = {
  query: string;
  sortByViews: boolean;
  publishedAfter?: string; // ISO date
  publishedBefore?: string;
  addLive?: boolean;
  addSets?: boolean;
};

export function shouldSortByViews(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q || q.length < 3) return false;
  return SORT_BY_VIEWS_KEYWORDS.some((kw) => q.includes(kw.toLowerCase()));
}

export function shouldAddLive(query: string): boolean {
  const q = query.trim().toLowerCase();
  return LIVE_PERFORMANCE_KEYWORDS.some((kw) => q.includes(kw.toLowerCase()));
}

export function shouldAddSets(query: string): boolean {
  const q = query.trim().toLowerCase();
  return SETS_MIX_KEYWORDS.some((kw) => q.includes(kw.toLowerCase()));
}

/**
 * Extract date range: "בין השנים 2000-2010" or "2000-2010" or "2000 to 2010"
 */
function extractDateRange(query: string): { after?: string; before?: string; rest: string } {
  let rest = query;
  let after: string | undefined;
  let before: string | undefined;

  // "בין השנים 2000-2010" or "בין 2000 ל-2010"
  const rangeMatch = rest.match(
    /(?:בין\s*(?:השנים?\s*)?)?(\d{4})\s*(?:[-–]\s*|ל[-־]?|to\s+)(\d{4})/i
  );
  if (rangeMatch) {
    after = `${rangeMatch[1]}-01-01T00:00:00Z`;
    before = `${rangeMatch[2]}-12-31T23:59:59Z`;
    rest = rest.replace(rangeMatch[0], "").replace(/\s+/g, " ").trim();
  }

  return { after, before, rest };
}

/**
 * Build optimized search query from natural language.
 * "תמצא לי הופעה חיה של מדונה" -> "Madonna live concert"
 * "ההופעה הכי הרבה צפיות של אייל גולן בין 2000-2010" -> "אייל גולן הופעה" + sortByViews + date
 */
export function parseSearchIntent(rawQuery: string): ParsedSearch {
  let q = rawQuery.trim();
  if (!q) return { query: "", sortByViews: false };

  const sortByViews = shouldSortByViews(q);
  const addLive = shouldAddLive(q);
  const addSets = shouldAddSets(q);

  const { after, before, rest } = extractDateRange(q);
  q = rest;

  let query = extractSearchTerms(q);

  if (addLive && !query.toLowerCase().includes("live") && !query.includes("הופעה")) {
    query = `${query} live concert`.trim();
  }

  if (addSets && !query.toLowerCase().includes("mix") && !query.toLowerCase().includes("set") && !query.includes("מיקס")) {
    query = `${query} mix`.trim();
  }

  // Map genre to English for better YouTube results (longest match first)
  const sortedGenres = Object.entries(GENRE_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [he, en] of sortedGenres) {
    const re = new RegExp(`(^|\\s)${he}(\\s|$)`, "gi");
    if (re.test(query)) {
      query = query.replace(re, (_, pre, suf) => pre + en + suf).trim();
      break;
    }
  }

  return {
    query,
    sortByViews,
    publishedAfter: after,
    publishedBefore: before,
    addLive: addLive || undefined,
    addSets: addSets || undefined,
  };
}

/**
 * Extract search terms from a "most played" / "live performance" query.
 */
export function extractSearchTerms(query: string): string {
  const q = query.trim();

  // Remove "תמצא לי" / "מצא לי" / "find me" prefixes
  let cleaned = q
    .replace(/^(?:תמצא|מצא)\s+(?:לי\s+)?/i, "")
    .replace(/^find\s+me\s+(?:a\s+)?/i, "")
    .replace(/^i\s+want\s+(?:the\s+)?/i, "")
    .replace(/^אני\s+רוצה\s+(?:את\s+)?/i, "");

  // סטים של [genre/artist] הכי מושמע/צפיות – extract genre/artist
  const matchSetsOf = cleaned.match(
    /(?:סטים?\s+של\s+)(.+?)(?:\s+(?:הכי|עם)\s+(?:מושמע|מנוגן|צפיות|צפים|פופולרי|מושמעום|מושמעים))?(?:\s+בין|\s*$)/i
  );
  if (matchSetsOf) {
    const term = matchSetsOf[1].trim().replace(/\s+בין.*$/, "").trim();
    if (term.length >= 2) return term;
  }

  // [artist] השיר/הופעה הכי מנוגן – extract artist
  const matchSuffix = cleaned.match(
    /^(.+?)\s+(?:השיר|ההופעה)\s+((הכי|עם)\s+)?(מושמע|מנוגן|נראה|פופולרי|הרבה צפיות)/i
  );
  if (matchSuffix) {
    const artist = matchSuffix[1].trim();
    if (artist.length >= 2) return artist;
  }

  // ההופעה/השיר הכי X של [artist]
  const matchOf = cleaned.match(
    /(?:ההופעה|השיר)\s+((הכי|עם)\s+)?(מושמע|מנוגן|נראה|פופולרי|הרבה צפיות)\s+(?:של\s+)?(.+?)(?:\s+בין|\s*$)/i
  );
  if (matchOf) {
    const artist = matchOf[3].trim().replace(/\s+בין.*$/, "").trim();
    if (artist.length >= 2) return artist;
  }

  // הופעה חיה של [artist] – artist can be followed by "בין השנים..."
  const matchLiveOf = cleaned.match(/הופעה\s+חיה\s+של\s+(.+)/i);
  if (matchLiveOf) {
    const artist = matchLiveOf[1].replace(/\s+בין\s+.*$/, "").trim();
    if (artist.length >= 2) return `${artist} live concert`;
  }

  // [artist] הופעה חיה
  const matchLive = cleaned.match(/^(.+?)\s+הופעה\s+חיה/i);
  if (matchLive) {
    const artist = matchLive[1].trim();
    if (artist.length >= 2) return `${artist} live concert`;
  }

  // live performance of [artist]
  const matchLiveEn = cleaned.match(/live\s+(?:performance|concert)\s+(?:of\s+)?(.+)/i);
  if (matchLiveEn) {
    const artist = matchLiveEn[1].replace(/\s+between\s+.*$/i, "").trim();
    if (artist.length >= 2) return `${artist} live`;
  }

  // Remove common prefixes/suffixes (Hebrew)
  cleaned = cleaned
    .replace(/\s+(?:הכי|עם)\s+(?:מושמע|מנוגן|צפיות|צפים|פופולרי|מושמעום|מושמעים)\s*$/i, "")
    .replace(/^סטים?\s+של\s+/i, "")
    .replace(/^השיר\s+((הכי|עם)\s+)?(מושמע|מנוגן|נראה|פופולרי|הרבה צפיות)\s+(של\s+)?/i, "")
    .replace(/^ההופעה\s+((הכי|עם)\s+)?(מושמע|מנוגן|נראה|פופולרי|הרבה צפיות)\s+(של\s+)?/i, "")
    .replace(/^הלהיט\s+(הכי\s+)?(גדול|מושמע|מנוגן)\s+(של\s+)?/i, "")
    .replace(/^השיר\s+(עם\s+)?(הכי\s+)?הרבה\s+צפיות\s+(של\s+)?/i, "")
    .replace(/^השיר\s+(המושמע|המנוגן|הנראה|הפופולרי)\s+ביותר\s+(של\s+)?/i, "")
    .replace(/^השיר\s+מספר\s+1\s+(של\s+)?/i, "");
  cleaned = cleaned
    .replace(/^most\s+(played|viewed|popular|streamed|listened|views)\s+(song\s+)?(of\s+)?/i, "")
    .replace(/^with\s+most\s+views\s+(of\s+)?/i, "")
    .replace(/^top\s+(song|hit)\s+(of\s+)?/i, "")
    .replace(/^best\s+song\s+(of\s+)?/i, "")
    .replace(/^popular\s+song\s+(of\s+)?/i, "")
    .replace(/^number\s+one\s+(song\s+)?(of\s+)?/i, "")
    .replace(/^#1\s+(song\s+)?(of\s+)?/i, "")
    .replace(/^biggest\s+hit\s+(of\s+)?/i, "")
    .replace(/^highest\s+views\s+(of\s+)?/i, "")
    .trim();

  return cleaned || q;
}
