"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DjCreatorAiSparkle } from "@/components/dj-creator-ai-mark";
import {
  buildDjCreatorMatchContextFromWizard,
  effectiveResultCount,
  isGymHighEnergyWizardVibes,
  matchDjCreatorRule,
} from "@/lib/recommendations/dj-creator-rules";
import {
  djCreatorRhythmicOptIn,
  filterDjCreatorWizardStyleBubbles,
  mergeDjCreatorAvoidSlugs,
} from "@/lib/recommendations/dj-creator-client-filters";
import { shouldAppendFreeTextToDjCreatorCatalogQuery } from "@/lib/recommendations/dj-creator-catalog-query";
import { parseDjBrief } from "@/lib/recommendations/dj-brief-parser";
import { computeDjCreatorMatrixKey } from "@/lib/recommendations/dj-creator-search-context";
import { useLocale } from "@/lib/locale-context";
import { getYouTubeThumbnail, inferPlaylistType } from "@/lib/playlist-utils";
import type { Playlist, PlaylistType } from "@/lib/playlist-types";
import { getPlaylistTracks } from "@/lib/playlist-types";
import { savePlaylistToLocal } from "@/lib/unified-sources-client";

type SmartSearchRow = {
  catalogItemId: string;
  title: string;
  url: string;
  /** Catalog thumbnail URL from smart-search (`CatalogItem.thumbnail`). */
  thumbnail?: string | null;
  provider: string | null;
  durationSec: number | null;
  curationRating: number;
  viewCount: number | null;
  likeCount: number | null;
  displayScore: number;
  baseFitScore: number;
  matchedTags: string[];
  recommendedBecause: string;
  /** Present when DJ avoid filter ran — full tag list for operators; not shown on main card. */
  taxonomySlugs?: string[];
};

type ParsedPayload = {
  rawQuery: string;
  businessType: string | null;
  coarseDaypart: string;
  vibeSegment: string;
  moodHints: string[];
  energyHint: string | null;
  styleTaxonomySlugs: string[];
  audienceHints: string[];
  conceptTags: string[];
  matchedPhrases: string[];
};

type CoveragePayload = {
  tier: "good" | "partial" | "none";
  maxDisplayScore: number;
  qualityRowCount: number;
  queryParsedOk: boolean;
  hints: string[];
};

type ApiOk = {
  kind: string;
  coverage: CoveragePayload;
  djAvoidStyleFilterApplied?: boolean;
  parsed: ParsedPayload;
  profileUsed: {
    primaryBusinessType: string;
    audienceDescriptors: string[];
    energyLevel: string | null;
    preferredStyleHints: string[];
    desiredMoodNotes: string | null;
    conceptTags: string[];
  };
  coarseDaypart: string;
  vibeSegment: string;
  fitRulesVersion: number;
  vibeRulesVersion: number;
  dictSlugCount: number;
  parserTaxonomyInDictionary: string[];
  rows: SmartSearchRow[];
};

/** A track is playable for any client only if it has a real http(s) URL (never a local path). */
const isPlayableUrl = (u: string | null | undefined): boolean => /^https?:\/\//i.test((u ?? "").trim());

const RESULT_COUNT = 10;

const DJ_CREATOR_SAVE_PLAYLIST_ENABLED = true;

function parsePlaylistIdFromJson(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { id?: unknown }).id;
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return id.length > 0 ? id : null;
}

/** Premium CTA inside assistant panel — cyan */
const accentBtn =
  "rounded-xl border border-cyan-400/25 bg-gradient-to-r from-sky-500/22 via-cyan-500/20 to-sky-400/22 font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_20px_rgba(34,211,238,0.08)] hover:from-sky-500/32 hover:via-cyan-500/28 hover:to-sky-400/30";
/** Inner surface once gradient chrome is applied (see panel wrapper). */
const sidePanelInner =
  "relative flex min-h-0 w-full flex-col overflow-hidden rounded-[15px] bg-[#0b121c] ring-1 ring-inset ring-cyan-400/12";

type Bubble = { id: string; label: string; labelHe: string; query: string; daypartApi?: string };

const BUSINESS_BUBBLES: Bubble[] = [
  { id: "restaurant", label: "Restaurant", labelHe: "מסעדה", query: "restaurant" },
  { id: "cafe", label: "Cafe", labelHe: "בית קפה", query: "cafe" },
  { id: "hotel", label: "Hotel / Lobby", labelHe: "מלון / לובי", query: "hotel lobby" },
  {
    id: "spa",
    label: "Spa / Wellness",
    labelHe: "ספא / בריאות",
    query: "spa wellness ambient calm healing meditation",
  },
  { id: "gym", label: "Gym", labelHe: "חדר כושר", query: "gym" },
  { id: "bar", label: "Bar / Nightlife", labelHe: "בר / לילה", query: "bar nightclub" },
  { id: "other", label: "Other", labelHe: "אחר", query: "" },
];

const DAYPART_BUBBLES: Bubble[] = [
  { id: "morning", label: "Morning", labelHe: "בוקר", query: "morning", daypartApi: "morning" },
  { id: "lunch", label: "Lunch", labelHe: "צהריים", query: "lunch", daypartApi: "lunch" },
  { id: "afternoon", label: "Afternoon", labelHe: "אחר הצהריים", query: "afternoon", daypartApi: "lunch" },
  { id: "evening", label: "Evening", labelHe: "ערב", query: "evening", daypartApi: "dinner" },
  { id: "night", label: "Night", labelHe: "לילה", query: "night", daypartApi: "night" },
];

const VIBE_BUBBLES: Bubble[] = [
  { id: "calm", label: "Calm", labelHe: "רגוע", query: "calm peaceful" },
  { id: "romantic", label: "Romantic", labelHe: "רומנטי", query: "romantic intimate" },
  { id: "premium", label: "Premium / Elegant", labelHe: "פרימיום / אלגנטי", query: "elegant premium sophisticated" },
  {
    id: "rhythmic",
    label: "Sexy / Rhythmic / Evening out",
    labelHe: "סקסי / קצבי / ערב יוצא",
    query: "sexy rhythmic lounge house groove evening danceable",
  },
  { id: "happy", label: "Happy", labelHe: "שמח", query: "happy upbeat cheerful" },
  { id: "energy", label: "High energy", labelHe: "אנרגיה גבוהה", query: "high energy" },
];

const STYLE_BUBBLES: Bubble[] = [
  { id: "auto", label: "Let DJ Creator choose", labelHe: "DJ Creator יבחר", query: "" },
  // World / local — the heart of the catalog we tagged (Mediterranean, Israeli, Mizrahi).
  { id: "mediterranean", label: "Mediterranean", labelHe: "ים תיכוני", query: "mediterranean" },
  { id: "israeli", label: "Israeli", labelHe: "ישראלי", query: "israeli hebrew" },
  { id: "mizrahi", label: "Mizrahi / Oriental", labelHe: "מזרחי", query: "mizrahi middle eastern oriental" },
  { id: "greek-italian", label: "Greek / Italian", labelHe: "יווני / איטלקי", query: "greek italian mediterranean" },
  // Lounge / soft.
  { id: "lounge", label: "Lounge", labelHe: "לאונג׳", query: "lounge" },
  { id: "bossa", label: "Bossa / Latin", labelHe: "בוסה / לטיני", query: "bossa nova latin" },
  { id: "jazz", label: "Smooth jazz", labelHe: "ג׳אז רך", query: "smooth jazz jazz lounge" },
  { id: "chill", label: "Chill / downtempo", labelHe: "צ׳יל", query: "chill downtempo ambient" },
  { id: "acoustic", label: "Acoustic / Soft", labelHe: "אקוסטי רך", query: "acoustic soft mellow easy listening" },
  {
    id: "soft-pop",
    label: "Soft pop / easy listening",
    labelHe: "פופ רך / האזנה קלה",
    query: "soft pop easy listening gentle covers piano ballad",
  },
  // Popular / upbeat.
  { id: "pop-hits", label: "Pop hits", labelHe: "להיטי פופ", query: "pop hits contemporary" },
  { id: "oldies", label: "Oldies / Retro", labelHe: "אולדיז / רטרו", query: "oldies retro classics 80s 90s" },
  { id: "rock", label: "Rock", labelHe: "רוק", query: "rock classic rock" },
  { id: "funk-soul", label: "Funk / Soul", labelHe: "פאנק / סול", query: "funk soul groove disco" },
  { id: "afro", label: "Afro / World", labelHe: "אפרו / עולם", query: "afro afrobeat world" },
];

/** Non-gym “rhythmic” vibe — explicit clubbier directions (still catalog-scoped). */
const RHYTHMIC_WIZARD_STYLE_BUBBLES: Bubble[] = [
  { id: "auto", label: "Let DJ Creator choose", labelHe: "DJ Creator יבחר", query: "" },
  { id: "lounge-house", label: "Lounge house", labelHe: "האוס לאונג׳", query: "lounge house deep house soulful house" },
  { id: "lounge", label: "Classic lounge", labelHe: "לאונג׳ קלאסי", query: "lounge cocktail" },
  { id: "house-edm", label: "House / dance", labelHe: "האוס / דאנס", query: "house edm dance club" },
  { id: "afro", label: "Afro / groove", labelHe: "אפרו / גרוב", query: "afro afro house groove" },
  { id: "dance", label: "Dance pop", labelHe: "דאנס פופ", query: "dance pop" },
  { id: "soul", label: "Soul / R&B", labelHe: "סול / R&B", query: "soul rnb" },
];

/** When no sheet row matches, still avoid generic calm defaults for gym high-energy. Mirrors GYM_* workbook rows. */
const GYM_HIGH_ENERGY_STYLE_FALLBACK: Bubble[] = [
  { id: "auto", label: "Let DJ Creator choose", labelHe: "תן ל-DJ Creator לבחור", query: "" },
  { id: "afro", label: "Afro", labelHe: "אפרו", query: "afro" },
  { id: "house-edm", label: "House / EDM", labelHe: "האוס / EDM", query: "house deep-house dance" },
  { id: "pop", label: "Pop", labelHe: "פופ", query: "pop" },
  { id: "hip-hop", label: "Hip Hop", labelHe: "היפ הופ", query: "hip hop" },
  { id: "dance", label: "Dance", labelHe: "דאנס", query: "dance" },
];

const GYM_INTENSITY_BUBBLES: Bubble[] = [
  { id: "warmup", label: "Warmup", labelHe: "חימום", query: "warm up light tempo easy cardio" },
  { id: "active", label: "Active", labelHe: "פעיל", query: "active steady cardio workout" },
  { id: "peak", label: "Peak", labelHe: "שיא", query: "peak energy HIIT intense workout" },
  { id: "mixed", label: "Mixed", labelHe: "מעורבב", query: "mixed intervals workout variety" },
];

/**
 * Musical DIRECTION (Genre / Style / Era). REQUIRED before any generation or template match — Place +
 * Mood alone (e.g. Gym + Happy) are not enough. "Other" reveals a free-text direction in Advanced.
 */
const GENRE_DIRECTION_BUBBLES: Bubble[] = [
  { id: "pop", label: "Pop", labelHe: "פופ", query: "pop" },
  { id: "house", label: "House", labelHe: "האוס", query: "house" },
  { id: "deep-house", label: "Deep House", labelHe: "דיפ האוס", query: "deep house" },
  { id: "afro", label: "Afro", labelHe: "אפרו", query: "afro afrobeat afro house" },
  { id: "80s-90s", label: "80s–90s Hits", labelHe: "להיטי 80–90", query: "80s 90s hits" },
  { id: "other", label: "Other", labelHe: "אחר", query: "" },
];

type Copy = {
  launcherTitle: string;
  openAssistant: string;
  brandTagline: string;
  catalogLine: string;
  tabChat: string;
  tabGuide: string;
  guideIntro: string;
  guideOpenVideo: string;
  welcome: string;
  tapOne: string;
  addNoteQ: string;
  addNoteHint: string;
  composerPlaceholder: string;
  getPicks: string;
  getPicksLoading: string;
  thinkingLine: string;
  back: string;
  needMore: string;
  close: string;
  ariaClose: string;
  widenPanel: string;
  narrowPanel: string;
  progressLabel: string;
  suggestedPlaylist: string;
  untitled: string;
  fromCatalog: string;
  setsFromCatalog: string;
  draftHint: string;
  savePlaylist: string;
  saveSoon: string;
  saveTitle: string;
  saveHint: string;
  saveNamePh: string;
  saveBtn: string;
  saving: string;
  cancel: string;
  enterName: string;
  gapsTitle: string;
  gapsBody: string;
  noneTitle: string;
  noneBody: string;
  picksHeading: string;
  noSets: string;
  startOver: string;
  savedLocationLine: string;
  openPlaylistLink: string;
  saveActionsFootnote: string;
  saveMalformedResponse: string;
  saveNotPersisted: string;
  questions: readonly [string, string, string, string];
  weakCatalogTitle: string;
  weakCatalogBody: string;
  tryAdjustChoices: string;
  requestEditorLead: string;
  requestEditorPlaceholder: string;
  requestEditorSubmit: string;
  requestEditorSubmitBusy: string;
  requestEditorThanks: string;
  requestEditorError: string;
  /** Gym high-energy intensity step only */
  questionIntensity: string;
};

const COPY_EN: Copy = {
  launcherTitle: "DJ Creator AI",
  openAssistant: "Open assistant",
  brandTagline: "Music intelligence",
  catalogLine: "Powered by your SyncBiz catalog — playback stays in the player",
  tabChat: "Chat",
  tabGuide: "Tutorials",
  guideIntro: "Short videos — how to use the player",
  guideOpenVideo: "Open on YouTube",
  welcome: "Hi — I’m DJ Creator AI",
  tapOne: "Pick one:",
  addNoteQ: "Want to add a note? Type below, then get your picks.",
  addNoteHint:
    "Optional — e.g. romantic boutique dinner; beach sunset reggae; calm 90s hits; sexy lounge (not clubby).",
  composerPlaceholder: "Tell me about your place — e.g. “calm morning cafe”, “Mediterranean dinner, romantic”… or tap the mic 🎤",
  getPicks: "Get my 10 picks",
  getPicksLoading: "Finding picks…",
  thinkingLine: "DJ Creator AI is building your music direction…",
  back: "Back",
  needMore: "Answer the steps above first (or add more in the box).",
  close: "Close",
  ariaClose: "Close DJ Creator AI",
  widenPanel: "Wider panel",
  narrowPanel: "Narrower panel",
  progressLabel: "Step",
  suggestedPlaylist: "Suggested playlist",
  untitled: "Untitled mix",
  fromCatalog: "Built from SyncBiz Catalog",
  setsFromCatalog: "suggested sets from catalog",
  draftHint: "10-set draft — save when you like it",
  savePlaylist: "Save as playlist",
  saveSoon: "Save — soon",
  saveTitle: "Save as playlist",
  saveHint: "Name it — playback won’t start.",
  saveNamePh: "Playlist name",
  saveBtn: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  enterName: "Enter a playlist name.",
  gapsTitle: "Some gaps in your catalog",
  gapsBody: "Close fits — your library might not cover every vibe yet.",
  noneTitle: "Not enough catalog matches yet",
  noneBody:
    "We could not find enough accurate matches in the SyncBiz catalog yet. Try again with different taps or describe what you want below.",
  picksHeading: "Your picks",
  noSets: "No accurate catalog matches passed our quality checks for this request.",
  startOver: "Start over",
  savedLocationLine: "Saved to Your playlists (genre: DJ Creator). Playback did not start.",
  openPlaylistLink: "Open playlist",
  saveActionsFootnote: "Nothing plays automatically — use the player when you are ready.",
  saveMalformedResponse:
    "Save didn’t finish — the server reply was incomplete. Nothing was confirmed. Try again.",
  saveNotPersisted:
    "Playlist could not be confirmed on the server — it may not have been saved. Try again.",
  questions: [
    "Where is this for?",
    "What time of day?",
    "What feeling?",
    "What style of music?",
  ],
  weakCatalogTitle: "Limited accurate matches",
  weakCatalogBody:
    "We could not find enough accurate matches in the SyncBiz catalog yet. Adjust your choices or describe what you need — our editors can take it from there.",
  tryAdjustChoices: "Try again / adjust choices",
  requestEditorLead:
    "Send us a more precise music request. A SyncBiz editor can prepare or expand this direction within 24–48 hours.",
  requestEditorPlaceholder:
    "E.g. romantic dinner for boutique restaurant, softer than typical jazz…",
  requestEditorSubmit: "Send request to SyncBiz editor",
  requestEditorSubmitBusy: "Sending…",
  requestEditorThanks: "Request recorded — the team will pick it up from the SyncBiz queue.",
  requestEditorError: "Couldn't record the request — try again shortly.",
  questionIntensity: "How intense should it feel?",
};

const COPY_HE: Copy = {
  launcherTitle: "DJ Creator AI",
  openAssistant: "פתיחת העוזר",
  brandTagline: "אינטליגנציית מוזיקה",
  catalogLine: "מבוסס על קטלוג SyncBiz — הניגון נשאר בנגן",
  tabChat: "צ׳אט",
  tabGuide: "מדריך",
  guideIntro: "סרטונים קצרים — איך לעבוד עם הנגן",
  guideOpenVideo: "פתיחה ב-YouTube",
  welcome: "היי — אני DJ Creator AI",
  tapOne: "בחר אחת:",
  addNoteQ: "רוצה להוסיף משהו? כתוב למטה, ואז קבל את ההמלצות.",
  addNoteHint: "רשות — למשל: רומנטי למסעדת בוטיק; רגאיי שקיעה בחוף; היטים שקטים משנות ה־90; לאונג׳ סקסי בלי מועדון.",
  composerPlaceholder: "ספרו לי על המקום — למשל: “קפה בוקר רגוע”, “מסעדה ים-תיכונית לערב, רומנטי”… או לחצו על המיקרופון 🎤",
  getPicks: "תביא לי 10 המלצות",
  getPicksLoading: "מחפש המלצות…",
  thinkingLine: "DJ Creator AI מכין את כיוון המוזיקה…",
  back: "חזרה",
  needMore: "קודם ענו על השלבים למעלה (או הוסיפו בטקסט למטה).",
  close: "סגירה",
  ariaClose: "סגירת DJ Creator AI",
  widenPanel: "פאנל רחב יותר",
  narrowPanel: "פאנל צר יותר",
  progressLabel: "שלב",
  suggestedPlaylist: "פלייליסט מוצע",
  untitled: "מיקס ללא שם",
  fromCatalog: "נבנה מקטלוג SyncBiz",
  setsFromCatalog: "סטים מוצעים מהקטלוג",
  draftHint: "טיוטה של עד 10 סטים — שמרו כשמתאים",
  savePlaylist: "שמור כפלייליסט",
  saveSoon: "שמירה — בקרוב",
  saveTitle: "שמור כפלייליסט",
  saveHint: "שם לפלייליסט — הנגן לא יתחיל לבד.",
  saveNamePh: "שם הפלייליסט",
  saveBtn: "שמירה",
  saving: "שומר…",
  cancel: "ביטול",
  enterName: "הזינו שם לפלייליסט.",
  gapsTitle: "חוסר התאמה חלקי בקטלוג",
  gapsBody: "אלו התאמות קרובות — אולי אין מספיק מוזיקה לכל הוויב.",
  noneTitle: "אין עדיין מספיק התאמות בקטלוג",
  noneBody:
    "לא מצאנו מספיק התאמות מדויקות בקטלוג SyncBiz עדיין. נסו שוב עם בחירות אחרות או תארו למטה מה אתם צריכים.",
  picksHeading: "הבחירות שלך",
  noSets: "אין מספיק התאמות איכותיות בקטלוג לכיוון הזה.",
  startOver: "מתחילים מחדש",
  savedLocationLine: "נשמר תחת הפלייליסטים שלכם (ז׳אנר: DJ Creator). הנגן לא התחיל.",
  openPlaylistLink: "פתיחת הפלייליסט",
  saveActionsFootnote: "הנגן לא מתחיל אוטומטית — השתמשו בנגן כשמתאים.",
  saveMalformedResponse: "השמירה לא הושלמה — תשובה לא מלאה מהשרת. לא אושר דבר.",
  saveNotPersisted: "לא אישרנו שהפלייליסט נשמר בשרת. נסו שוב.",
  questions: [
    "לאן זה מיועד?",
    "איזה זמן ביום?",
    "איזו תחושה?",
    "איזה סגנון מוזיקה?",
  ],
  weakCatalogTitle: "התאמות מדויקות מעטות",
  weakCatalogBody:
    "לא מצאנו מספיק התאמות מדויקות בקטלוג SyncBiz עדיין. אפשר לכוונן את הבחירות או לתאר מה צריך — והעריכה האנושית תמשיך משם.",
  tryAdjustChoices: "נסו שוב / כווננו את הבחירות",
  requestEditorLead:
    "שלחו לנו בקשת מוזיקה מדויקת יותר. עורך SyncBiz יכול להכין או להרחיב את הכיוון תוך 24–48 שעות.",
  requestEditorPlaceholder: "לדוגמה: רומנטי למסעדת בוטיק שקטה מג׳אז רגוע…",
  requestEditorSubmit: "שליחת בקשה לעורך SyncBiz",
  requestEditorSubmitBusy: "שולחים…",
  requestEditorThanks: "הבקשה נרשמה — הצוות יקבל מהתור הפנימי.",
  requestEditorError: "לא הצלחנו לרשום את הבקשה — נסו שוב מאוחר יותר.",
  questionIntensity: "כמה אינטנסיבי זה צריך להרגיש?",
};

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

type WizardPick = { id: string; label: string; query: string; daypartApi?: string };

const emptyPick: WizardPick = { id: "", label: "", query: "" };

/** Convert a bubble (or none) to a WizardPick — used by the free-text/voice parser path. */
function bubbleToPick(bubbles: readonly Bubble[], id: string | null): WizardPick | null {
  if (!id) return null;
  const b = bubbles.find((x) => x.id === id);
  return b ? { id: b.id, label: b.label, query: b.query, daypartApi: b.daypartApi } : null;
}

function bubbleLabel(b: Bubble, he: boolean): string {
  return he ? b.labelHe : b.label;
}

function buildCatalogSearchQuery(input: {
  freeText: string;
  businessQuery: string;
  daypartLabel: string;
  vibeQuery: string;
  styleQuery: string;
  languageQuery: string;
}): string {
  const parts: string[] = [];
  if (input.freeText.trim()) parts.push(input.freeText.trim());
  if (input.businessQuery) parts.push(input.businessQuery);
  if (input.daypartLabel) parts.push(input.daypartLabel);
  if (input.vibeQuery.trim()) parts.push(input.vibeQuery.trim());
  if (input.styleQuery.trim()) parts.push(input.styleQuery.trim());
  if (input.languageQuery) parts.push(input.languageQuery);
  return parts.join(" ").trim();
}

function suggestedPlaylistName(input: {
  freeText: string;
  businessLabel: string;
  daypartLabel: string;
  vibeLabel: string;
  styleLabel: string;
}): string {
  if (input.freeText.trim().length >= 3) {
    return input.freeText.trim().replace(/\s+/g, " ").slice(0, 72);
  }
  const styleBit =
    input.styleLabel && !/choose|יבחר/i.test(input.styleLabel)
      ? input.styleLabel.split("/")[0].trim()
      : "";
  const bits = [input.daypartLabel, input.businessLabel, input.vibeLabel, styleBit].filter(
    (s): s is string => Boolean(s && s.length > 0),
  );
  const base = bits.length ? bits.join(" · ") : "DJ Creator mix";
  return base.slice(0, 72);
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Compact counts for views/likes: 1234 → "1.2K", 3_400_000 → "3.4M". */
function fmtCount(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`.replace(".0K", "K");
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`.replace(".0M", "M");
}

function shortReason(text: string): string {
  const s = text.replace(/^Recommended because\s*/i, "").trim();
  if (s.length <= 160) return s;
  return `${s.slice(0, 157)}…`;
}

/** Stable identity for a draft row — used for de-dup AND for user removal before saving. */
function rowKey(r: SmartSearchRow): string {
  return (r.title?.trim().toLowerCase() || r.url?.trim().toLowerCase() || "");
}

function estimateDraftDuration(rows: SmartSearchRow[]): { seconds: number; allKnown: boolean } | null {
  if (!rows.length) return null;
  let sum = 0;
  let known = 0;
  for (const r of rows) {
    if (r.durationSec != null && r.durationSec >= 0) {
      sum += r.durationSec;
      known++;
    }
  }
  if (known === 0) return null;
  return { seconds: sum, allKnown: known === rows.length };
}

function fmtTotalDuration(est: { seconds: number; allKnown: boolean }): string {
  const sec = est.seconds;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const core =
    m >= 60
      ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  const partialNote = est.allKnown ? "" : " · חלק מהאורכים חסרים בקטלוג";
  return `בערך ${core} סה״כ${partialNote}`;
}

/** English total line — keep shorter label */
function fmtTotalDurationEn(est: { seconds: number; allKnown: boolean }): string {
  const sec = est.seconds;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const core =
    m >= 60
      ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  const partialNote = est.allKnown ? "" : " · some lengths missing in catalog";
  return `Est. ${core} total${partialNote}`;
}

type GuideItem = {
  titleEn: string;
  titleHe: string;
  blurbEn: string;
  blurbHe: string;
  href: string;
};

/** Placeholder search links — replace with real SyncBiz academy URLs when available. */
const PLAYER_GUIDE_VIDEOS: GuideItem[] = [
  {
    titleEn: "Library & playback basics",
    titleHe: "ספרייה והפעלה — בסיס",
    blurbEn: "Sources, search, and how playback works.",
    blurbHe: "מקורות, חיפוש, ואיך ההשמעה עובדת.",
    href: "https://www.youtube.com/results?search_query=SyncBiz+library+player+tutorial",
  },
  {
    titleEn: "Playlists & queue",
    titleHe: "פלייליסטים ותור",
    blurbEn: "Build lists, tiles, and session queue.",
    blurbHe: "בניית רשימות, אריחים, ותור להשמעה.",
    href: "https://www.youtube.com/results?search_query=SyncBiz+playlist+queue+tutorial",
  },
  {
    titleEn: "Schedule & dayparts",
    titleHe: "תזמון וחלקי יום",
    blurbEn: "When music runs by time of day.",
    blurbHe: "מתי מוזיקה רצה לפי חלקי היום.",
    href: "https://www.youtube.com/results?search_query=SyncBiz+schedule+music+tutorial",
  },
  {
    titleEn: "DJ Creator AI & catalog picks",
    titleHe: "DJ Creator AI והקטלוג",
    blurbEn: "How the assistant uses your catalog only.",
    blurbHe: "איך העוזר משתמש רק בקטלוג שלכם.",
    href: "https://www.youtube.com/results?search_query=SyncBiz+catalog+DJ+assistant",
  },
];

export type DjCreatorAiShellProps = {
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  /** "launcher" = the right-rail card only; "panel" = the assistant in the CENTER monitor. */
  variant?: "launcher" | "panel";
  /** Launcher click (opens the center monitor panel). */
  onOpen?: () => void;
};

export function DjCreatorAiShell({
  drawerOpen,
  onDrawerOpenChange,
  variant = "launcher",
  onOpen,
}: DjCreatorAiShellProps) {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? COPY_HE : COPY_EN;
  const dir: "rtl" | "ltr" = he ? "rtl" : "ltr";

  const [tab, setTab] = useState<"chat" | "guide">("chat");
  const [step, setStep] = useState<WizardStep>(0);
  const [business, setBusiness] = useState<WizardPick>(emptyPick);
  const [daypart, setDaypart] = useState<WizardPick>(emptyPick);
  const [vibe, setVibe] = useState<WizardPick>(emptyPick);
  const [style, setStyle] = useState<WizardPick>(emptyPick);
  /** Gym high-energy only: Warmup / Active / Peak / Mixed (never language). */
  const [gymIntensity, setGymIntensity] = useState<WizardPick>(emptyPick);
  /** Required musical direction (Genre/Style/Era). "Other" uses the free-text direction below. */
  const [genreDirection, setGenreDirection] = useState<WizardPick>(emptyPick);
  const [freeText, setFreeText] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiOk | null>(null);
  /** Slice 1: top-up tracks pulled from ADMIN TEMPLATE/OFFICIAL playlists when the catalog is thin. */
  const [templateRows, setTemplateRows] = useState<SmartSearchRow[]>([]);
  /** Tracks the user removed from the draft before saving (by rowKey). Reset on each new search. */
  const [removedTrackKeys, setRemovedTrackKeys] = useState<Set<string>>(() => new Set());
  /** Surfaced (never swallowed) search failure — shows a clear message + Try again instead of a silent empty state. */
  const [searchError, setSearchError] = useState<string | null>(null);
  /** Seconds elapsed while a search runs — drives the waiting UI (spinner + escalating status). */
  const [elapsedSec, setElapsedSec] = useState(0);
  /** Guards against double-clicks / concurrent runs firing runSearch twice. */
  const runningRef = useRef(false);
  /** Length: user picks by track count (≤50) or by duration (30/60/120/200 min). 4 min/song estimate; real durations used when present. */
  const [lengthMode, setLengthMode] = useState<"count" | "duration">("count");
  const [lengthCount, setLengthCount] = useState(15);
  const [lengthMinutes, setLengthMinutes] = useState(60);

  const [saveOpen, setSaveOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSavedPlaylistId, setLastSavedPlaylistId] = useState<string | null>(null);

  const [editorNote, setEditorNote] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorStatus, setEditorStatus] = useState<"idle" | "ok" | "err">("idle");

  const scrollRef = useRef<HTMLDivElement>(null);

  const gymHighEnergy = useMemo(
    () => isGymHighEnergyWizardVibes(business.id, vibe.id),
    [business.id, vibe.id],
  );
  const lastBubbleStep: WizardStep = gymHighEnergy ? 4 : 3;
  const reviewStep: WizardStep = gymHighEnergy ? 5 : 4;

  // A real style pick counts as a musical direction; otherwise the user must pick a Genre/Style/Era.
  const styleIsDirection = !!style.id && style.id !== "auto" && !!style.query.trim();
  const directionQuery = useMemo(() => {
    if (styleIsDirection) return style.query.trim();
    if (genreDirection.id === "other") return freeText.trim(); // "Other" → free-text direction
    if (genreDirection.query.trim()) return genreDirection.query.trim();
    // Anything the owner TYPED (e.g. "1980") counts as a direction too — never leave them stuck on
    // the chooser with a valid brief already written.
    return freeText.trim();
  }, [styleIsDirection, style.query, genreDirection.id, genreDirection.query, freeText]);
  const hasDirection = directionQuery.length > 0;

  const picks = useMemo(() => [business, daypart, vibe, style, gymIntensity], [business, daypart, vibe, style, gymIntensity]);

  const ruleMatchForStyle = useMemo(() => {
    const ctx = buildDjCreatorMatchContextFromWizard({
      businessId: business.id,
      daypartId: daypart.id,
      vibeId: vibe.id,
    });
    if (!ctx) return null;
    return matchDjCreatorRule(ctx);
  }, [business.id, daypart.id, vibe.id]);

  const styleBubblesDynamic = useMemo((): Bubble[] => {
    if (!gymHighEnergy && vibe.id === "rhythmic") {
      return filterDjCreatorWizardStyleBubbles(vibe.id, RHYTHMIC_WIZARD_STYLE_BUBBLES);
    }
    let rows: Bubble[];
    const opts = ruleMatchForStyle?.styleOptionsForWizard;
    if (opts && opts.length > 0) {
      rows = opts.map((o) => ({
        id: o.id,
        label: o.label,
        labelHe: o.labelHe,
        query: o.query,
      }));
    } else if (gymHighEnergy) {
      rows = GYM_HIGH_ENERGY_STYLE_FALLBACK;
    } else {
      rows = STYLE_BUBBLES;
    }
    return filterDjCreatorWizardStyleBubbles(vibe.id, rows);
  }, [ruleMatchForStyle, business.id, vibe.id, gymHighEnergy]);

  /** Intensity only for gym high-energy — not language. */
  const finalStepBubbles = useMemo((): Bubble[] => {
    if (!gymHighEnergy) return [];
    return GYM_INTENSITY_BUBBLES;
  }, [gymHighEnergy]);

  const styleQuestionLine = useMemo(() => {
    return he && ruleMatchForStyle?.styleQuestionHe?.trim()
      ? ruleMatchForStyle.styleQuestionHe
      : t.questions[3];
  }, [he, ruleMatchForStyle, t.questions]);

  const finalStepQuestionLine = useMemo(() => {
    if (!gymHighEnergy) return "";
    return t.questionIntensity;
  }, [gymHighEnergy, t.questionIntensity]);

  const effectiveResultCap = useMemo(
    () => effectiveResultCount(ruleMatchForStyle, RESULT_COUNT),
    [ruleMatchForStyle],
  );

  const currentStepBubbles = useMemo((): Bubble[] => {
    if (step === 0) return BUSINESS_BUBBLES;
    if (step === 1) return DAYPART_BUBBLES;
    if (step === 2) return VIBE_BUBBLES;
    if (step === 3) return styleBubblesDynamic;
    if (gymHighEnergy && step === 4) return finalStepBubbles;
    return [];
  }, [step, styleBubblesDynamic, gymHighEnergy, finalStepBubbles]);

  const setters = useMemo(
    () =>
      [setBusiness, setDaypart, setVibe, setStyle, setGymIntensity] as Array<(p: WizardPick) => void>,
    [],
  );

  const wizardCatalogQueryOnly = useMemo(
    () =>
      buildCatalogSearchQuery({
        freeText: "",
        businessQuery: business.query,
        daypartLabel: daypart.label ? daypart.query : "",
        vibeQuery: vibe.query,
        styleQuery: style.query,
        languageQuery: gymHighEnergy ? gymIntensity.query : "",
      }),
    [business.query, daypart.label, daypart.query, vibe.query, style.query, gymIntensity.query, gymHighEnergy],
  );

  const builtQuery = useMemo(
    () =>
      buildCatalogSearchQuery({
        freeText: shouldAppendFreeTextToDjCreatorCatalogQuery(freeText, wizardCatalogQueryOnly)
          ? freeText
          : "",
        businessQuery: business.query,
        daypartLabel: daypart.label ? daypart.query : "",
        vibeQuery: vibe.query,
        styleQuery: style.query,
        languageQuery: gymHighEnergy ? gymIntensity.query : "",
      }),
    [freeText, wizardCatalogQueryOnly, business.query, daypart.label, daypart.query, vibe.query, style.query, gymIntensity.query, gymHighEnergy],
  );

  const daypartApiParam = daypart.daypartApi ?? "";

  /** User target: by count (≤50) or by duration (≈ minutes/4 songs, refined by real durations below). Never > 50. */
  const targetCount = useMemo(
    () => (lengthMode === "count" ? Math.min(50, Math.max(1, lengthCount)) : Math.min(50, Math.max(1, Math.round(lengthMinutes / 4)))),
    [lengthMode, lengthCount, lengthMinutes],
  );

  const draftRows = useMemo(() => {
    const catalog = data?.rows ?? [];
    const seen = new Set(catalog.map(rowKey));
    let combined = [...catalog];
    for (const tr of templateRows) {
      const k = rowKey(tr);
      if (k && !seen.has(k)) { seen.add(k); combined.push(tr); }
    }
    // Drop any tracks the user removed before saving.
    if (removedTrackKeys.size > 0) combined = combined.filter((r) => !removedTrackKeys.has(rowKey(r)));
    if (lengthMode === "duration") {
      // Accumulate by REAL track length (4 min fallback when unknown) until the target is reached; hard-cap 50.
      const targetSec = lengthMinutes * 60;
      const out: SmartSearchRow[] = [];
      let sum = 0;
      for (const r of combined) {
        if (out.length >= 50) break;
        out.push(r);
        sum += r.durationSec != null && r.durationSec > 0 ? r.durationSec : 240;
        if (sum >= targetSec) break;
      }
      return out;
    }
    return combined.slice(0, Math.min(50, targetCount)); // by count — never more than 50
  }, [data?.rows, templateRows, lengthMode, lengthMinutes, targetCount, removedTrackKeys]);

  /** Kept for a small inline note only — NO LONGER a hard block on showing/saving a playlist. */
  const catalogSufficient = data?.coverage?.tier === "good";
  const playableDraftCount = useMemo(() => draftRows.filter((r) => isPlayableUrl(r.url)).length, [draftRows]);
  const topUpCount = useMemo(() => draftRows.filter((r) => (r.recommendedBecause ?? "").startsWith("From template:")).length, [draftRows]);

  const draftDurationEstimate = useMemo(() => estimateDraftDuration(draftRows), [draftRows]);

  const resetWizard = useCallback(() => {
    setTab("chat");
    setStep(0);
    setBusiness(emptyPick);
    setDaypart(emptyPick);
    setVibe(emptyPick);
    setStyle(emptyPick);
    setGymIntensity(emptyPick);
    setGenreDirection(emptyPick);
    setFreeText("");
    setData(null);
    setTemplateRows([]);
    setError(null);
    setSaveOpen(false);
    setSaveMessage(null);
    setLastSavedPlaylistId(null);
    setPlaylistName("");
    setEditorNote("");
    setEditorStatus("idle");
    setEditorBusy(false);
  }, []);

  const closeDrawer = useCallback(() => {
    onDrawerOpenChange(false);
    setSaveOpen(false);
  }, [onDrawerOpenChange]);

  /* Reset before paint when opening — avoids rendering stale results/tree for one frame (reduces DOM/reconcile churn that can trigger removeChild errors). */
  useLayoutEffect(() => {
    if (drawerOpen) resetWizard();
  }, [drawerOpen, resetWizard]);

  useEffect(() => {
    if (!drawerOpen || tab !== "chat") return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    });
  }, [drawerOpen, tab, step, data, he]);

  // Waiting UI: tick the elapsed-seconds counter only while a search is running.
  useEffect(() => {
    if (!loading) {
      setElapsedSec(0);
      return;
    }
    const start = performance.now();
    const id = window.setInterval(() => setElapsedSec(Math.floor((performance.now() - start) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  const runSearch = useCallback(async () => {
    const copy = locale === "he" ? COPY_HE : COPY_EN;
    if (step < reviewStep) {
      setError(copy.needMore);
      return;
    }
    // A musical direction (Genre/Style/Era) is required before catalog OR template matching.
    if (!hasDirection) {
      setError(locale === "he" ? "בחרו כיוון מוזיקלי (ז׳אנר / סגנון / עידן)." : "Pick a musical direction (Genre / Style / Era).");
      return;
    }
    // Ensure the direction is part of the catalog query even when no style bubble was chosen.
    const q = styleIsDirection ? builtQuery : [builtQuery, directionQuery].filter(Boolean).join(" ");
    if (q.length < 2) {
      setError(locale === "he" ? "הוסיפו עוד פרט אחד לפחות." : "Add at least one more detail.");
      return;
    }
    // Prevent double-clicks / concurrent runs (set synchronously before the first await).
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    setError(null);
    setSearchError(null);
    setRemovedTrackKeys(new Set()); // fresh search → start with a clean draft (no stale removals)
    setSaveMessage(null);
    setLastSavedPlaylistId(null);
    setEditorStatus("idle");
    try {
      const ctx = buildDjCreatorMatchContextFromWizard({
        businessId: business.id,
        daypartId: daypart.id,
        vibeId: vibe.id,
      });
      const rule = ctx ? matchDjCreatorRule(ctx) : null;
      // Request enough to satisfy the user's Length target (with a small buffer), never over 50.
      const want = Math.min(50, targetCount);
      const cap = Math.min(50, Math.max(want + 5, effectiveResultCount(rule, RESULT_COUNT), 15));
      const u = new URL("/api/catalog/smart-search", window.location.origin);
      u.searchParams.set("q", q);
      u.searchParams.set("limit", String(cap));
      if (daypartApiParam) u.searchParams.set("daypart", daypartApiParam);
      const mergedAvoid = mergeDjCreatorAvoidSlugs(
        vibe.id,
        rule?.avoidStyleSlugs,
        djCreatorRhythmicOptIn(vibe.id, style.id),
        style.id,
      );
      if (mergedAvoid.length > 0) {
        u.searchParams.set("avoidSlugs", mergedAvoid.join(","));
      }
      const djKey = computeDjCreatorMatrixKey({
        businessId: business.id,
        vibeId: vibe.id,
        daypartId: daypart.id,
        gymIntensityId: gymHighEnergy ? gymIntensity.id : "",
      });
      if (djKey) u.searchParams.set("djCx", djKey);
      const res = await fetch(u.toString(), { credentials: "include" });
      const json = (await res.json()) as ApiOk | { error?: string };
      if (!res.ok) {
        setError("error" in json && json.error ? String(json.error) : locale === "he" ? "לא הצלחנו לטעון." : "Couldn’t load results.");
        setData(null);
        setTemplateRows([]);
        return;
      }
      setData(json as ApiOk);
      // Fill tiers (Template → Catalog → Charts): when the catalog can't reach the target,
      // top up so the DJ Creator ALWAYS returns a playable, editable playlist (never a dead-end).
      const catalogCount = (json as ApiOk).rows?.length ?? 0;
      const catalogPlayable = ((json as ApiOk).rows ?? []).filter((r) => isPlayableUrl(r.url)).length;
      const thin = (json as ApiOk).coverage?.tier !== "good" || catalogCount < cap;
      let fill: SmartSearchRow[] = [];
      // Tier 2 — ADMIN templates (relevance-filtered by the chosen musical direction only).
      if (thin) {
        try {
          const tu = new URL("/api/dj-creator/template-topup", window.location.origin);
          tu.searchParams.set("genre", directionQuery); // clean musical direction — NOT the mood as a fallback
          tu.searchParams.set("business", business.query || "");
          tu.searchParams.set("daypart", daypartApiParam || "");
          tu.searchParams.set("mood", vibe.query || "");
          tu.searchParams.set("limit", String(Math.min(50, Math.max(want + 5 - catalogCount, 6))));
          const tuRes = await fetch(tu.toString(), { credentials: "include" });
          const tuJson = (await tuRes.json()) as { rows?: SmartSearchRow[] };
          if (Array.isArray(tuJson?.rows)) fill = tuJson.rows;
        } catch {
          fill = [];
        }
      }
      // Tier 2a — SyncBiz Charts: our catalog's MOST-PLAYED tracks matching this direction
      // (genre-accurate; ranked by real YouTube views). This is the owner's "① catalog, most-played".
      if (catalogPlayable + fill.filter((r) => isPlayableUrl(r.url)).length < want) {
        try {
          const cu = new URL("/api/dj-creator/charts", window.location.origin);
          cu.searchParams.set("genre", directionQuery);
          cu.searchParams.set("limit", String(Math.min(30, Math.max(want - catalogPlayable, 8))));
          const cRes = await fetch(cu.toString(), { credentials: "include" });
          const cJson = (await cRes.json()) as { rows?: SmartSearchRow[] };
          if (Array.isArray(cJson?.rows) && cJson.rows.length > 0) {
            const seen = new Set(fill.map(rowKey));
            for (const r of cJson.rows) {
              const k = rowKey(r);
              if (k && !seen.has(k)) { seen.add(k); fill.push(r); }
            }
          }
        } catch {
          /* charts best-effort — bank + YouTube below still guarantee a result */
        }
      }
      // Tier 2b — YOUR bank: the owner's own SELECTED tracks matching this direction (they play
      // local-first from the physical files on the bank machine; the YouTube URL is the remote fallback).
      // Runs BEFORE YouTube so the DJ AI prefers the owner's music over generic web results.
      if (catalogPlayable + fill.filter((r) => isPlayableUrl(r.url)).length < want) {
        try {
          const bu = new URL("/api/dj-creator/bank", window.location.origin);
          bu.searchParams.set("genre", directionQuery);
          bu.searchParams.set("limit", String(Math.min(30, Math.max(want - catalogPlayable, 8))));
          const bRes = await fetch(bu.toString(), { credentials: "include" });
          const bJson = (await bRes.json()) as { rows?: SmartSearchRow[] };
          if (Array.isArray(bJson?.rows) && bJson.rows.length > 0) {
            const seen = new Set(fill.map(rowKey));
            for (const r of bJson.rows) {
              const k = rowKey(r);
              if (k && !seen.has(k)) { seen.add(k); fill.push(r); }
            }
          }
        } catch {
          /* bank tier is best-effort — the YouTube tier below still guarantees a result */
        }
      }
      // Tier 3 — Charts / known-music: if catalog + templates + bank still can't reach a playable floor,
      // resolve real tracks live from YouTube for the EXACT chosen direction (genre-matched, cached).
      // This is the fail-forward guarantee — it can never come back empty for a valid direction.
      const playableSoFar = catalogPlayable + fill.filter((r) => isPlayableUrl(r.url)).length;
      const floor = Math.min(want, 6);
      // The last-resort tier: if we reach it and STILL end with nothing, that's a real failure to build
      // (usually the external source timing out and returning an empty list), not a quality "no match".
      const attemptedRecommend = playableSoFar < floor;
      if (attemptedRecommend) {
        // Generous client-side timeout so a genuine hang surfaces as an error (Try again) rather than
        // an endless spinner. This is error-handling only — it does NOT change the search engine.
        const ctrl = new AbortController();
        const timeoutId = window.setTimeout(() => ctrl.abort(), 75000);
        try {
          const ru = new URL("/api/dj-creator/recommend", window.location.origin);
          ru.searchParams.set("genre", directionQuery);
          ru.searchParams.set("mood", vibe.query || "");
          ru.searchParams.set("daypart", daypartApiParam || "");
          ru.searchParams.set("limit", String(Math.min(20, Math.max(want - playableSoFar, 8))));
          const rRes = await fetch(ru.toString(), { credentials: "include", signal: ctrl.signal });
          const rJson = (await rRes.json()) as { rows?: SmartSearchRow[] };
          if (Array.isArray(rJson?.rows) && rJson.rows.length > 0) fill = [...fill, ...rJson.rows];
        } catch {
          /* timeout / network — handled by the empty-result check below (never swallowed silently) */
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
      setTemplateRows(fill);
      // If we tried every tier (including the last resort) and have nothing playable, surface a clear,
      // actionable error with Try again — NEVER the silent/misleading "no accurate catalog matches".
      const anyPlayable = catalogPlayable + fill.filter((r) => isPlayableUrl(r.url)).length;
      if (anyPlayable === 0 && attemptedRecommend) {
        setSearchError(
          locale === "he"
            ? "לא הצלחנו להשלים את הפלייליסט כרגע — ייתכן שהחיפוש לקח יותר מדי זמן. נסו שוב."
            : "We couldn't finish building the playlist just now — the search may have taken too long. Please try again.",
        );
      }
      setPlaylistName(
        suggestedPlaylistName({
          freeText,
          businessLabel: business.label,
          daypartLabel: daypart.label,
          vibeLabel: vibe.label,
          styleLabel: style.label,
        }),
      );
      setTab("chat");
    } catch {
      // Unexpected failure (e.g. catalog fetch). data is null → the composer view renders, which surfaces
      // `error` inline; the Create button doubles as retry. Never a silent dead-end.
      setData(null);
      setTemplateRows([]);
      setError(locale === "he" ? "בעיית רשת. נסו שוב." : "Network error. Please try again.");
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, [
    builtQuery,
    daypartApiParam,
    freeText,
    business.id,
    business.label,
    business.query,
    daypart.id,
    daypart.label,
    vibe.id,
    vibe.label,
    vibe.query,
    style.id,
    style.label,
    style.query,
    gymHighEnergy,
    gymIntensity.id,
    step,
    reviewStep,
    locale,
    targetCount,
    hasDirection,
    styleIsDirection,
    directionQuery,
  ]);

  /**
   * Phase 1 (DJ-Creator-as-agent): understand what the owner TYPED or SPOKE.
   * Parse the free text into wizard picks (business/daypart/vibe/style + avoid),
   * fill them, jump to the review step, and flag an auto-generate. State is set
   * here; the effect below fires runSearch on the NEXT render (fresh builtQuery).
   */
  const autoGenRef = useRef(false);
  const runFromText = useCallback(() => {
    const brief = parseDjBrief(freeText);
    if (!brief.matched && brief.remainder.trim().length < 2) {
      setError(locale === "he" ? "ספרו לי קצת יותר — סוג העסק, שעה, או תחושה." : "Tell me a bit more — the venue, time, or feeling.");
      return;
    }
    const b = bubbleToPick(BUSINESS_BUBBLES, brief.businessId);
    const d = bubbleToPick(DAYPART_BUBBLES, brief.daypartId);
    const v = bubbleToPick(VIBE_BUBBLES, brief.vibeId);
    const s = bubbleToPick(STYLE_BUBBLES, brief.styleId);
    if (b) setBusiness(b);
    if (d) setDaypart(d);
    if (v) setVibe(v);
    if (s) setStyle(s);
    // Keep only the leftover keywords (genres etc.) as free text so the query isn't double-fed.
    setFreeText(brief.remainder);
    setStep(reviewStep);
    setError(null);
    autoGenRef.current = true;
  }, [freeText, reviewStep, locale]);

  // Auto-generate once picks/step have settled from runFromText.
  useEffect(() => {
    if (!autoGenRef.current) return;
    autoGenRef.current = false;
    void runSearch();
  }, [step, business, daypart, vibe, style, runSearch]);

  // Voice input (laptop mic) → fills the composer, then the owner can send it.
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<unknown>(null);
  const startVoice = useCallback(() => {
    if (typeof window === "undefined") return;
    const SR = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown });
    const Ctor = (SR.SpeechRecognition ?? SR.webkitSpeechRecognition) as
      | (new () => {
          lang: string; interimResults: boolean; continuous: boolean;
          onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
          onend: (() => void) | null; onerror: (() => void) | null;
          start: () => void; stop: () => void;
        })
      | undefined;
    if (!Ctor) {
      setError(locale === "he" ? "הדפדפן לא תומך בהקלטה — הקלד/י במקום." : "Voice input isn't supported here — type instead.");
      return;
    }
    try {
      const rec = new Ctor();
      recognitionRef.current = rec;
      rec.lang = locale === "he" ? "he-IL" : "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        setFreeText(text);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  }, [locale]);

  const savePlaylist = useCallback(async () => {
    if (!DJ_CREATOR_SAVE_PLAYLIST_ENABLED) return;
    // Slice 1: never require a "good" catalog — but never save an empty/unplayable list either.
    if (!data || !draftRows.some((r) => isPlayableUrl(r.url))) return;
    const copy = locale === "he" ? COPY_HE : COPY_EN;
    const name = playlistName.trim();
    if (!name) {
      setSaveMessage(copy.enterName);
      return;
    }
    setSaveBusy(true);
    setSaveMessage(null);
    setLastSavedPlaylistId(null);
    try {
      const tracks: Array<{
        id: string;
        name: string;
        type: PlaylistType;
        url: string;
        catalogItemId: string;
        cover?: string;
      }> = [];
      let playlistThumbnail = "";
      for (const r of draftRows) {
        const type = inferPlaylistType(r.url) as PlaylistType;
        const urlTrim = r.url.trim();
        const fromCatalog = `${r.thumbnail ?? ""}`.trim();
        const derivedYt = getYouTubeThumbnail(urlTrim) ?? "";
        const coverStr = fromCatalog || derivedYt;
        const track = {
          id: crypto.randomUUID(),
          name: r.title,
          type,
          url: urlTrim,
          catalogItemId: r.catalogItemId,
          ...(coverStr ? { cover: coverStr } : {}),
        };
        tracks.push(track);
        if (!playlistThumbnail && coverStr) playlistThumbnail = coverStr;
      }
      const first = tracks[0];
      const res = await fetch("/api/playlists", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          url: first.url,
          genre: "DJ Creator",
          type: first.type,
          thumbnail: playlistThumbnail,
          tracks,
        }),
      });
      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      if (!res.ok) {
        const errObj = payload && typeof payload === "object" ? (payload as { error?: unknown }).error : undefined;
        const errMsg =
          typeof errObj === "string" && errObj.trim()
            ? errObj
            : locale === "he"
              ? "לא נשמר."
              : "Could not save.";
        setSaveMessage(errMsg);
        return;
      }
      const provisionalId = parsePlaylistIdFromJson(payload);
      if (!provisionalId) {
        setSaveMessage(copy.saveMalformedResponse);
        return;
      }
      const verifyRes = await fetch(`/api/playlists/${encodeURIComponent(provisionalId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      let confirmed: Playlist;
      try {
        if (!verifyRes.ok) throw new Error("verify");
        confirmed = (await verifyRes.json()) as Playlist;
      } catch {
        setSaveMessage(copy.saveNotPersisted);
        return;
      }
      const confirmedId =
        confirmed && typeof confirmed.id === "string" ? confirmed.id.trim() : "";
      if (!confirmedId || confirmedId !== provisionalId) {
        setSaveMessage(copy.saveMalformedResponse);
        return;
      }
      if (String(confirmed.genre ?? "").trim() !== "DJ Creator") {
        setSaveMessage(copy.saveNotPersisted);
        return;
      }
      const confirmedTracks = getPlaylistTracks(confirmed);
      if (
        confirmedTracks.length < 1 ||
        confirmedTracks.length < draftRows.length
      ) {
        setSaveMessage(copy.saveNotPersisted);
        return;
      }
      savePlaylistToLocal(confirmed);
      setSaveOpen(false);
      setLastSavedPlaylistId(confirmedId);
      window.dispatchEvent(new Event("library-updated"));
      // After a successful save, return to the Library view (owner directive) — a brief "Saved ✓"
      // confirmation shows first, then the panel closes so the new playlist is visible in Library.
      window.setTimeout(() => closeDrawer(), 1100);
    } catch {
      setSaveMessage(locale === "he" ? "לא נשמר." : "Could not save.");
    } finally {
      setSaveBusy(false);
    }
  }, [data, draftRows, playlistName, locale, closeDrawer]);

  const submitEditorRequest = useCallback(async () => {
    const copy = locale === "he" ? COPY_HE : COPY_EN;
    const fallback = [
      freeText.trim(),
      gymHighEnergy && gymIntensity.label ? `Intensity: ${gymIntensity.label}` : "",
      `Business: ${business.label}`,
      `Daypart: ${daypart.label}`,
      `Vibe: ${vibe.label}`,
      `Style: ${style.label}`,
    ]
      .filter((s) => s.length > 0)
      .join(" · ");
    const msg = `${editorNote.trim() || fallback}`.slice(0, 4000);
    if (msg.length < 3) {
      setEditorStatus("err");
      return;
    }
    setEditorBusy(true);
    setEditorStatus("idle");
    try {
      const res = await fetch("/api/dj-creator/editor-request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessType: business.label,
          daypart: daypart.label,
          vibe: vibe.label,
          style: style.label,
          freeTextRequest: freeText.trim(),
          editorMessage: msg,
          gymIntensity: gymHighEnergy && gymIntensity.label ? gymIntensity.label : null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditorStatus("err");
        setError(typeof (j as { error?: unknown }).error === "string" ? String((j as { error: string }).error) : copy.requestEditorError);
        return;
      }
      setEditorStatus("ok");
      setEditorNote("");
      setError(null);
    } catch {
      setEditorStatus("err");
      setError(copy.requestEditorError);
    } finally {
      setEditorBusy(false);
    }
  }, [
    locale,
    editorNote,
    freeText,
    business.label,
    daypart.label,
    vibe.label,
    style.label,
    gymHighEnergy,
    gymIntensity.label,
  ]);

  const goBack = useCallback(() => {
    setError(null);
    if (step === reviewStep) {
      setStep(lastBubbleStep);
      if (gymHighEnergy) setGymIntensity(emptyPick);
      else setStyle(emptyPick);
      return;
    }
    if (gymHighEnergy && step === 4) {
      setStep(3);
      setStyle(emptyPick);
      return;
    }
    if (step === 3) {
      setStep(2);
      setVibe(emptyPick);
      setError(null);
      return;
    }
    if (step === 2) {
      setStep(1);
      setDaypart(emptyPick);
      setError(null);
      return;
    }
    if (step === 1) {
      setStep(0);
      setBusiness(emptyPick);
      setError(null);
    }
  }, [step, reviewStep, lastBubbleStep, gymHighEnergy]);

  const pickBubble = useCallback(
    (b: Bubble, idx: number) => {
      setters[idx]({
        id: b.id,
        label: bubbleLabel(b, he),
        query: b.query,
        daypartApi: b.daypartApi,
      });
      setStep((s) => {
        if (s < lastBubbleStep) return (s + 1) as WizardStep;
        if (s === lastBubbleStep) return reviewStep;
        return s;
      });
      setError(null);
    },
    [setters, he, lastBubbleStep, reviewStep],
  );

  const progress = step >= reviewStep ? 1 : (step + 1) / (lastBubbleStep + 1);

  if (variant === "launcher") {
    // One clean clickable card (no button-inside-a-button). Opens the CENTER monitor.
    return (
      <button
        type="button"
        onClick={() => (onOpen ? onOpen() : onDrawerOpenChange(true))}
        dir={dir}
        className="group flex w-full items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-start shadow-[0_8px_28px_rgba(0,0,0,0.35)] transition-colors duration-150 hover:border-white/[0.16] hover:bg-white/[0.06] active:scale-[0.99]"
      >
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-[#7db8ff]"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7L12 4z" />
            <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="library-text-title block text-sm font-semibold tracking-tight text-[#faf8f5]">{t.launcherTitle}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">{t.openAssistant}</span>
        </span>
        <svg className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-150 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <>
      {drawerOpen ? (
        <div
          className="sb-anim-rise flex max-h-[min(85vh,760px)] w-full min-h-0 flex-1 flex-col rounded-2xl border border-white/[0.1] bg-[#101014] p-px shadow-[0_18px_48px_rgba(0,0,0,0.5)]"
          role="dialog"
          aria-labelledby="djc-assistant-title"
          dir={dir}
        >
            <div className={`${sidePanelInner} min-h-0 flex-1`}>
            <header className="shrink-0 border-b border-white/8 px-4 pb-3 pt-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 pe-1">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t.brandTagline}</p>
                  <h2 id="djc-assistant-title" className="text-base font-bold tracking-tight text-white">
                    {t.launcherTitle}
                  </h2>
                  <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{t.catalogLine}</p>
                  {!data && tab === "chat" ? (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-400 to-cyan-200 transition-[width] duration-300"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Help/Tutorials — small toggle button (was a full-width bottom tab bar). */}
                  <button
                    type="button"
                    onClick={() => setTab((prev) => (prev === "guide" ? "chat" : "guide"))}
                    aria-pressed={tab === "guide"}
                    aria-label={t.tabGuide}
                    title={t.tabGuide}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-[11px] transition ${
                      tab === "guide"
                        ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200"
                        : "border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.4.9-1.4 1.7v.5" /><line x1="12" y1="17" x2="12" y2="17" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={closeDrawer}
                    className="rounded-xl border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-white/10"
                  >
                    {t.close}
                  </button>
                </div>
              </div>
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {tab === "guide" ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[12px] leading-snug text-slate-400">{t.guideIntro}</p>
                  {PLAYER_GUIDE_VIDEOS.map((item) => (
                    <div key={item.href + item.titleEn} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                      <p className="text-sm font-semibold text-slate-100">{he ? item.titleHe : item.titleEn}</p>
                      <p className="mt-1 text-[11px] leading-snug text-slate-500">{he ? item.blurbHe : item.blurbEn}</p>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-400 hover:text-sky-300"
                      >
                        {t.guideOpenVideo}
                        <span aria-hidden>↗</span>
                      </a>
                    </div>
                  ))}
                </div>
              ) : loading ? (
                /* Waiting state takes precedence over any empty/partial result — the user never sees
                   "No playable track" while a search is still running. */
                <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <svg className="h-7 w-7 animate-spin text-cyan-300" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
                  </svg>
                  <div className="max-w-[19rem]">
                    <p className="text-[13px] font-medium text-cyan-50">
                      {elapsedSec < 4
                        ? (he ? "מחפש מוזיקה מתאימה…" : "Finding the right music…")
                        : elapsedSec < 15
                          ? (he ? "בודק קטלוג, מאגרים ומקורות חיצוניים…" : "Checking catalog, pools, and external sources…")
                          : (he ? "החיפוש לוקח מעט יותר זמן — אנחנו עדיין עובדים על הפלייליסט שלך." : "This is taking a bit longer — we're still building your playlist.")}
                    </p>
                    <p className="mt-1 text-[11px] tabular-nums text-cyan-200/70">
                      {he ? `זמן שעבר: ${elapsedSec} ש׳` : `Elapsed: ${elapsedSec}s`}
                    </p>
                  </div>
                </div>
              ) : !data ? (
                <div className="flex flex-col gap-3">
                  {/* Three clear phases: Place · Style & mood · Length */}
                  <ol className="flex flex-wrap items-center gap-1 text-[10px] font-medium">
                    {[
                      { n: 0, label: he ? "מקום" : "Place" },
                      { n: 1, label: he ? "סגנון ואווירה" : "Style & mood" },
                      { n: 2, label: he ? "אורך" : "Length" },
                    ].map((ph, idx) => {
                      const phase = step <= 1 ? 0 : step < reviewStep ? 1 : 2;
                      const active = ph.n === phase;
                      const done = ph.n < phase;
                      return (
                        <li key={ph.n} className="flex items-center gap-1">
                          <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${active ? "bg-cyan-500 text-white" : done ? "bg-cyan-500/25 text-cyan-200" : "bg-white/10 text-slate-500"}`}>{ph.n + 1}</span>
                          <span className={active ? "text-slate-100" : "text-slate-500"}>{ph.label}</span>
                          {idx < 2 ? <span className="mx-0.5 text-slate-700" aria-hidden>›</span> : null}
                        </li>
                      );
                    })}
                  </ol>

                  {/* Current selections as small chips (replaces the echoed chat bubbles) */}
                  {picks.some((p, i) => p?.label && i < Math.min(step, reviewStep)) ? (
                    <div className="flex flex-wrap gap-1.5">
                      {picks.map((p, i) =>
                        p?.label && i < Math.min(step, reviewStep) ? (
                          <span key={`sel-${i}`} className="inline-flex items-center rounded-full border border-cyan-300/70 bg-cyan-400/25 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-50 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]">
                            {p.label}
                          </span>
                        ) : null,
                      )}
                    </div>
                  ) : null}

                  {step <= lastBubbleStep ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-[12px] font-medium leading-snug text-slate-200">
                        {step === 3
                          ? styleQuestionLine
                          : gymHighEnergy && step === 4
                            ? finalStepQuestionLine
                            : t.questions[step as 0 | 1 | 2]}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {currentStepBubbles.map((b, btnIdx) => (
                          <button
                            key={`${step}-bubble-${btnIdx}-${b.id}`}
                            type="button"
                            onClick={() => pickBubble(b, step)}
                            className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-slate-100 transition hover:border-cyan-400/50 hover:bg-cyan-500/[0.12] active:scale-[0.98]"
                          >
                            {bubbleLabel(b, he)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[12px] leading-snug text-slate-300">
                      {t.addNoteQ}
                      <span className="mt-1 block text-[11px] text-slate-500">{t.addNoteHint}</span>
                    </div>
                  )}

                  {error ? <p className="text-[12px] text-rose-400">{error}</p> : null}

                  {step > 0 && !data ? (
                    <button
                      type="button"
                      onClick={goBack}
                      className="self-start text-[12px] font-medium text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
                    >
                      {t.back}
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="mb-2 border-b border-white/8 pb-2">
                    <p className="break-words text-[14px] font-semibold text-white">
                      {playlistName.trim() ? playlistName.trim() : t.untitled}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      <span className="text-slate-300">{draftRows.length} {t.setsFromCatalog}</span>
                      {topUpCount > 0 ? <span className="text-cyan-200/90"> · +{topUpCount} {he ? "מתבניות" : "from templates"}</span> : null}
                      {draftDurationEstimate ? (
                        <>
                          <span className="text-slate-600"> · </span>
                          <span>{he ? fmtTotalDuration(draftDurationEstimate) : fmtTotalDurationEn(draftDurationEstimate)}</span>
                        </>
                      ) : null}
                    </p>
                    {!catalogSufficient ? (
                      <p className="mt-1 text-[10px] leading-snug text-amber-300/90">{t.weakCatalogTitle}{topUpCount > 0 ? (he ? " — הושלם מתבניות." : " — topped up from templates.") : "."}</p>
                    ) : null}
                  </div>

                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t.picksHeading}{" "}
                    <span className="font-normal text-slate-600">({effectiveResultCap} max)</span>
                  </h3>

                  <ul className="mt-2 space-y-2">
                    {draftRows.length === 0 ? (
                      searchError ? (
                        <li className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-3">
                          <p className="text-[13px] leading-relaxed text-amber-100/95">{searchError}</p>
                          <button
                            type="button"
                            onClick={() => void runSearch()}
                            className="mt-2 inline-flex min-h-[2.25rem] items-center justify-center rounded-xl border border-amber-300/50 bg-amber-400/15 px-3 text-[12px] font-semibold text-amber-100 hover:bg-amber-400/25"
                          >
                            {he ? "נסו שוב" : "Try again"}
                          </button>
                        </li>
                      ) : (
                        <li className="text-[13px] text-slate-500">{t.noSets}</li>
                      )
                    ) : (
                      draftRows.map((r, idx) => (
                        <li
                          key={`draft-${idx}-${r.catalogItemId}`}
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="w-4 shrink-0 pt-0.5 text-center text-[10px] text-slate-500">{idx + 1}</span>
                            {r.thumbnail ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.thumbnail} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-md bg-white/5 object-cover" />
                            ) : (
                              <div className="h-11 w-11 shrink-0 rounded-md bg-white/5" aria-hidden />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-sm font-medium text-slate-100">{r.title}</p>
                              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-slate-500">
                                <span className="tabular-nums">{fmtDuration(r.durationSec)}</span>
                                {fmtCount(r.viewCount) ? (
                                  <>
                                    <span className="text-slate-600">·</span>
                                    <span className="inline-flex items-center gap-0.5">
                                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3"/></svg>
                                      <span className="tabular-nums">{fmtCount(r.viewCount)}</span>
                                    </span>
                                  </>
                                ) : null}
                                {fmtCount(r.likeCount) ? (
                                  <>
                                    <span className="text-slate-600">·</span>
                                    <span className="inline-flex items-center gap-0.5">
                                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                      <span className="tabular-nums">{fmtCount(r.likeCount)}</span>
                                    </span>
                                  </>
                                ) : null}
                                {r.curationRating > 0 ? (
                                  <>
                                    <span className="text-slate-600">·</span>
                                    <span>SYNC <span className="tabular-nums text-slate-400">{r.curationRating}</span></span>
                                  </>
                                ) : null}
                              </p>
                              {r.matchedTags.length > 0 ? (
                                <p className="mt-1 text-[10px] text-cyan-200/80">{r.matchedTags.join(" · ")}</p>
                              ) : null}
                              <p className="mt-1 text-[11px] text-slate-500">{shortReason(r.recommendedBecause)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setRemovedTrackKeys((prev) => { const next = new Set(prev); next.add(rowKey(r)); return next; })}
                              aria-label={he ? "הסר קטע" : "Remove track"}
                              title={he ? "הסר קטע" : "Remove track"}
                              className="shrink-0 self-start rounded-md p-1 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300"
                            >
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>

                  {lastSavedPlaylistId ? (
                    <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2.5" role="status" aria-live="polite">
                      <svg className="h-4 w-4 shrink-0 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <p className="text-[12px] font-medium leading-relaxed text-emerald-100/95">
                        {he ? "נשמר ✓ — חוזרים ל-Library…" : "Saved ✓ — returning to Library…"}
                      </p>
                    </div>
                  ) : null}

                  {playableDraftCount > 0 && DJ_CREATOR_SAVE_PLAYLIST_ENABLED ? (
                    <div className="mt-3 space-y-1 border-t border-white/8 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSaveMessage(null);
                          setLastSavedPlaylistId(null);
                          setSaveOpen(true);
                        }}
                        className="w-full rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-400 px-4 py-2.5 text-[12px] font-semibold text-[#04252b] shadow-[0_6px_20px_rgba(34,211,238,0.3)] transition hover:from-cyan-200 hover:to-cyan-300 active:scale-[0.99]"
                      >
                        {t.savePlaylist}
                      </button>
                      <p className="text-[10px] text-slate-500">{t.saveActionsFootnote}</p>
                    </div>
                  ) : (
                    <p className="mt-3 border-t border-white/8 pt-3 text-[11px] text-slate-500">
                      {he ? "אין עדיין קטע נגין לשמירה — נסו לכוונן בחירה או בקשו עורך." : "No playable track to save yet — adjust a choice or ask an editor."}
                    </p>
                  )}

                  {/* Secondary, optional — a human editor. Not a failure screen. */}
                  <details className="group mt-3 rounded-xl border border-white/10 bg-white/[0.03]">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200">
                      <svg className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {he ? "בקשת עורך אנושי (אופציונלי)" : "Request a human editor (optional)"}
                    </summary>
                    <div className="border-t border-white/8 p-2">
                      <textarea
                        value={editorNote}
                        onChange={(e) => setEditorNote(e.target.value)}
                        rows={2}
                        placeholder={t.requestEditorPlaceholder}
                        className="max-h-28 min-h-[3rem] w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
                        dir="auto"
                      />
                      <button
                        type="button"
                        disabled={editorBusy}
                        onClick={() => void submitEditorRequest()}
                        className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-medium text-slate-300 hover:bg-white/[0.08] disabled:opacity-50"
                      >
                        {editorBusy ? t.requestEditorSubmitBusy : t.requestEditorSubmit}
                      </button>
                      {editorStatus === "ok" ? <p className="mt-1.5 text-[11px] text-emerald-300">{t.requestEditorThanks}</p> : null}
                      {editorStatus === "err" ? <p className="mt-1.5 text-[11px] text-rose-300">{t.requestEditorError}</p> : null}
                    </div>
                  </details>

                  <button
                    type="button"
                    onClick={resetWizard}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 text-[12px] font-medium text-slate-300 hover:bg-white/[0.08]"
                  >
                    {t.startOver}
                  </button>
                </>
              )}
            </div>

            {tab === "chat" && !data ? (
              <div className="shrink-0 border-t border-white/8 bg-[#0c0e14] px-3 py-2.5">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  {loading && step >= reviewStep ? (
                    <div className="mb-2 flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
                      <DjCreatorAiSparkle className="mt-0.5 h-4 w-4 shrink-0 animate-pulse" />
                      <div className="flex min-w-0 flex-1 items-stretch gap-2">
                        <div className="w-0.5 shrink-0 rounded-full bg-gradient-to-b from-cyan-300 via-sky-400 to-cyan-200 animate-pulse" />
                        <p className="text-[13px] leading-snug text-slate-300">{t.thinkingLine}</p>
                      </div>
                    </div>
                  ) : null}

                  {/* Musical direction (Genre/Style/Era) — REQUIRED. Place + Mood alone are not enough. */}
                  {step >= reviewStep && !hasDirection ? (
                    <div className="mb-2 rounded-xl border border-cyan-400/30 bg-cyan-500/[0.06] p-2">
                      <p className="mb-1.5 text-[12px] font-medium text-cyan-100">{he ? "איזה כיוון מוזיקלי מתאים לך?" : "Which musical direction suits you?"}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {GENRE_DIRECTION_BUBBLES.map((b) => (
                          <button key={b.id} type="button" onClick={() => setGenreDirection({ id: b.id, label: b.label, query: b.query })}
                            className={`rounded-full px-3 py-1 text-[12px] font-medium ${genreDirection.id === b.id ? "bg-cyan-400/30 text-cyan-50 border border-cyan-300/60" : "border border-white/12 text-slate-200 hover:bg-white/5"}`}>
                            {bubbleLabel(b, he)}
                          </button>
                        ))}
                      </div>
                      {genreDirection.id === "other" ? (
                        <p className="mt-1 text-[10px] text-slate-400">{he ? "כתבו ז׳אנר ב״אפשרויות מתקדמות״ למטה." : "Type a genre in Advanced options below."}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Length — by track count (≤50) or by duration. Never more than 50 tracks. */}
                  <div className="mb-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{he ? "אורך" : "Length"}</span>
                      <div className="ms-auto flex gap-1">
                        {(["count", "duration"] as const).map((m) => (
                          <button key={m} type="button" onClick={() => setLengthMode(m)}
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${lengthMode === m ? "bg-cyan-400/25 text-cyan-100 border border-cyan-300/50" : "border border-white/12 text-slate-400 hover:bg-white/5"}`}>
                            {m === "count" ? (he ? "מספר שירים" : "By tracks") : (he ? "משך" : "By duration")}
                          </button>
                        ))}
                      </div>
                    </div>
                    {lengthMode === "count" ? (
                      <div className="flex flex-wrap gap-1.5">
                        {[8, 15, 30, 50].map((n) => (
                          <button key={n} type="button" onClick={() => setLengthCount(n)}
                            className={`rounded-full px-3 py-1 text-[12px] font-medium ${lengthCount === n ? "bg-cyan-400/25 text-cyan-50 border border-cyan-300/60" : "border border-white/12 text-slate-200 hover:bg-white/5"}`}>
                            {n} {he ? "שירים" : "songs"}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {[30, 60, 120, 200].map((mn) => (
                            <button key={mn} type="button" onClick={() => setLengthMinutes(mn)}
                              className={`rounded-full px-3 py-1 text-[12px] font-medium ${lengthMinutes === mn ? "bg-cyan-400/25 text-cyan-50 border border-cyan-300/60" : "border border-white/12 text-slate-200 hover:bg-white/5"}`}>
                              {mn} {he ? "דק׳" : "min"}
                            </button>
                          ))}
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">≈ {Math.min(50, Math.round(lengthMinutes / 4))} {he ? "שירים · לפי אורך אמיתי כשקיים" : "songs · uses real track lengths when available"}</p>
                      </>
                    )}
                  </div>

                  {/* Advanced options — free text + voice, collapsed by default */}
                  <details className="group mb-2 rounded-xl border border-white/10 bg-white/[0.03]">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200">
                      <svg className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {he ? "אפשרויות מתקדמות" : "Advanced options"}
                    </summary>
                    <div className="flex flex-col gap-2 border-t border-white/8 p-2">
                      <textarea
                        value={freeText}
                        onChange={(e) => setFreeText(e.target.value)}
                        rows={2}
                        placeholder={t.composerPlaceholder}
                        className="max-h-24 min-h-[2.5rem] w-full resize-y rounded-lg bg-white/[0.04] px-2 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
                        dir="auto"
                      />
                      <button
                        type="button"
                        onClick={startVoice}
                        aria-label={locale === "he" ? "תיאור בקול" : "Describe by voice"}
                        title={locale === "he" ? "תיאור בקול" : "Describe by voice"}
                        className={`inline-flex min-h-[2.25rem] items-center justify-center gap-1.5 self-start rounded-xl border px-3 text-[12px] font-medium ${
                          listening
                            ? "border-rose-400/60 bg-rose-500/15 text-rose-300 animate-pulse"
                            : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                        }`}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="9" y="2" width="6" height="12" rx="3" />
                          <path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" />
                        </svg>
                        {locale === "he" ? "תיאור בקול" : "Describe by voice"}
                      </button>
                    </div>
                  </details>

                  {/* Primary action — gated on a musical direction at the review step. */}
                  <button
                    type="button"
                    disabled={loading || (!freeText.trim() && step < reviewStep) || (step >= reviewStep && !hasDirection)}
                    onClick={() => {
                      if (freeText.trim() && !business.id) runFromText();
                      else void runSearch();
                    }}
                    className="w-full min-h-[2.75rem] rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-400 px-3 text-[13px] font-semibold text-[#04252b] shadow-[0_6px_20px_rgba(34,211,238,0.35)] transition hover:from-cyan-200 hover:to-cyan-300 active:scale-[0.99] disabled:opacity-40"
                  >
                    {loading ? (he ? "יוצר…" : "Creating…") : (he ? "צור פלייליסט" : "Create playlist")}
                  </button>
                </div>
              </div>
            ) : null}


            {saveOpen && DJ_CREATOR_SAVE_PLAYLIST_ENABLED ? (
              <div
                className="absolute inset-0 z-10 flex items-end justify-center rounded-2xl bg-slate-950/70 p-3 sm:items-center"
                role="dialog"
                aria-label={t.saveTitle}
              >
                <div className="w-full max-w-sm rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-400/25 via-sky-400/20 to-cyan-300/25 p-px shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
                  <div className="rounded-2xl bg-[#12141c] p-4">
                    <p className="text-[13px] font-semibold text-white">{t.saveTitle}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{t.saveHint}</p>
                    <input
                      value={playlistName}
                      onChange={(e) => setPlaylistName(e.target.value)}
                      placeholder={t.saveNamePh}
                      className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600"
                      dir="auto"
                    />
                    {saveMessage ? <p className="mt-2 text-[11px] text-rose-300">{saveMessage}</p> : null}
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={saveBusy}
                        onClick={() => void savePlaylist()}
                        className={`flex-1 min-h-[2.5rem] text-[13px] ${accentBtn} disabled:opacity-70`}
                      >
                        {saveBusy ? (
                          <span className="inline-flex items-center justify-center gap-1.5">
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
                            </svg>
                            {t.saving}
                          </span>
                        ) : (
                          t.saveBtn
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={saveBusy}
                        onClick={() => setSaveOpen(false)}
                        className="rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
                      >
                        {t.cancel}
                      </button>
                    </div>
                    {saveBusy ? (
                      <p className="mt-2 text-[11px] text-cyan-200/80" role="status" aria-live="polite">
                        {he ? "שומר את הפלייליסט… זה יכול לקחת כמה שניות." : "Saving your playlist… this can take a few seconds."}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            </div>
          </div>
      ) : null}
    </>
  );
}
