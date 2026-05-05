"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DjCreatorAiSparkle, DjCreatorAiWarmSpark } from "@/components/dj-creator-ai-mark";
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
/** Launcher card only — warm frame; radius matches library rail (Guest / My link). */
const launcherOpenBtn =
  "rounded-lg border border-amber-400/40 bg-gradient-to-r from-amber-500/18 via-orange-500/14 to-amber-600/16 font-semibold text-[#fffbeb] text-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_4px_18px_rgba(245,158,11,0.12)] hover:from-amber-500/26 hover:via-orange-500/20 hover:to-amber-600/22";
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
  { id: "lounge", label: "Lounge", labelHe: "לאונג׳", query: "lounge" },
  { id: "bossa", label: "Bossa Nova", labelHe: "בוסה נובה", query: "bossa nova" },
  { id: "jazz", label: "Smooth jazz / Lounge jazz", labelHe: "ג׳אז רך / לאונג׳", query: "smooth jazz jazz lounge" },
  { id: "chill", label: "Chill / downtempo", labelHe: "צ׳יל", query: "chill downtempo ambient" },
  { id: "acoustic", label: "Acoustic / Soft", labelHe: "אקוסטי רך", query: "acoustic soft mellow easy listening" },
  {
    id: "soft-pop",
    label: "Soft pop / easy listening",
    labelHe: "פופ רך / האזנה קלה",
    query: "soft pop easy listening gentle covers piano ballad",
  },
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
  composerPlaceholder: "Type anything extra…",
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
  composerPlaceholder: "אפשר לכתוב כאן…",
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

function shortReason(text: string): string {
  const s = text.replace(/^Recommended because\s*/i, "").trim();
  if (s.length <= 160) return s;
  return `${s.slice(0, 157)}…`;
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
};

export function DjCreatorAiShell({ drawerOpen, onDrawerOpenChange }: DjCreatorAiShellProps) {
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
  const [freeText, setFreeText] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiOk | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [lastSavedPlaylistId, setLastSavedPlaylistId] = useState<string | null>(null);
  const [panelSize, setPanelSize] = useState<"comfortable" | "compact">("comfortable");

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

  const draftRows = useMemo(() => {
    if (!data?.rows?.length) return [];
    return data.rows.slice(0, effectiveResultCap);
  }, [data?.rows, effectiveResultCap]);

  const catalogSufficient = data?.coverage?.tier === "good";

  const draftDurationEstimate = useMemo(() => estimateDraftDuration(draftRows), [draftRows]);

  const resetWizard = useCallback(() => {
    setTab("chat");
    setStep(0);
    setBusiness(emptyPick);
    setDaypart(emptyPick);
    setVibe(emptyPick);
    setStyle(emptyPick);
    setGymIntensity(emptyPick);
    setFreeText("");
    setData(null);
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

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("djc-panel-size");
      if (raw === "compact" || raw === "comfortable") setPanelSize(raw);
    } catch {
      /* ignore */
    }
  }, []);

  const togglePanelSize = useCallback(() => {
    setPanelSize((prev) => {
      const next = prev === "comfortable" ? "compact" : "comfortable";
      try {
        sessionStorage.setItem("djc-panel-size", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const runSearch = useCallback(async () => {
    const copy = locale === "he" ? COPY_HE : COPY_EN;
    if (step < reviewStep) {
      setError(copy.needMore);
      return;
    }
    const q = builtQuery;
    if (q.length < 2) {
      setError(locale === "he" ? "הוסיפו עוד פרט אחד לפחות." : "Add at least one more detail.");
      return;
    }
    setLoading(true);
    setError(null);
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
      const cap = effectiveResultCount(rule, RESULT_COUNT);
      const u = new URL("/api/catalog/smart-search", window.location.origin);
      u.searchParams.set("q", q);
      u.searchParams.set("limit", String(Math.max(cap, 15)));
      if (daypartApiParam) u.searchParams.set("daypart", daypartApiParam);
      const mergedAvoid = mergeDjCreatorAvoidSlugs(
        vibe.id,
        rule?.avoidStyleSlugs,
        djCreatorRhythmicOptIn(vibe.id, style.id),
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
        return;
      }
      setData(json as ApiOk);
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
      setError(locale === "he" ? "בעיית רשת." : "Network error.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [
    builtQuery,
    daypartApiParam,
    freeText,
    business.id,
    business.label,
    daypart.id,
    daypart.label,
    vibe.id,
    vibe.label,
    style.id,
    style.label,
    gymHighEnergy,
    gymIntensity.id,
    step,
    reviewStep,
    locale,
  ]);

  const savePlaylist = useCallback(async () => {
    if (!DJ_CREATOR_SAVE_PLAYLIST_ENABLED) return;
    if (!data || draftRows.length < 1 || !catalogSufficient) return;
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
    } catch {
      setSaveMessage(locale === "he" ? "לא נשמר." : "Could not save.");
    } finally {
      setSaveBusy(false);
    }
  }, [data, draftRows, playlistName, locale, catalogSufficient]);

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

  return (
    <>
      <section className="relative overflow-hidden rounded-2xl border border-amber-600/30 bg-[#141210] p-3 shadow-[0_8px_28px_rgba(0,0,0,0.42),inset_0_0_0_1px_rgba(217,119,6,0.12)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.2]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(251,191,36,0.14) 1px, transparent 1px),
              linear-gradient(90deg, rgba(251,191,36,0.14) 1px, transparent 1px)
            `,
            backgroundSize: "14px 14px",
          }}
          aria-hidden
        />
        <div className="relative flex flex-col items-center gap-3 sm:flex-row sm:items-center" dir={dir}>
          <DjCreatorAiWarmSpark className="h-[5.25rem] w-[5.25rem] shrink-0 sm:h-[5.75rem] sm:w-[5.75rem]" />
          <div className="min-w-0 w-full flex-1 text-center sm:text-start">
            <p className="library-text-title text-sm font-semibold tracking-tight text-[#faf8f5]">{t.launcherTitle}</p>
            <button
              type="button"
              onClick={() => onDrawerOpenChange(true)}
              className={`mt-2 inline-flex w-full max-w-[200px] justify-center px-3 py-1.5 sm:mt-1.5 ${launcherOpenBtn}`}
            >
              {t.openAssistant}
            </button>
          </div>
        </div>
      </section>

      {drawerOpen ? (
        <>
          <button
            type="button"
            aria-label={t.ariaClose}
            className="fixed inset-0 z-[119] bg-slate-950/20"
            onClick={closeDrawer}
          />
          <div
            className={`fixed right-3 bottom-3 z-[120] flex flex-col rounded-2xl border border-cyan-400/22 bg-gradient-to-b from-cyan-500/[0.06] via-sky-500/[0.04] to-transparent p-px shadow-[0_0_28px_rgba(34,211,238,0.14),0_18px_48px_rgba(0,0,0,0.5)] ${
              panelSize === "compact"
                ? "w-[min(calc(100vw-1.5rem),320px)]"
                : "w-[min(calc(100vw-1.5rem),428px)]"
            }`}
            role="dialog"
            aria-labelledby="djc-assistant-title"
            dir={dir}
          >
            <div
              className={`${sidePanelInner} h-[min(680px,calc(100vh-3rem))] max-h-[calc(100vh-3rem)]`}
            >
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
                  <button
                    type="button"
                    onClick={togglePanelSize}
                    aria-label={panelSize === "compact" ? t.widenPanel : t.narrowPanel}
                    title={panelSize === "compact" ? t.widenPanel : t.narrowPanel}
                    className="rounded-xl border border-white/10 bg-white/[0.05] px-2 py-2 text-slate-200 hover:bg-white/10"
                  >
                    {panelSize === "compact" ? (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                        <rect x="3" y="5" width="10" height="14" rx="2" />
                        <rect x="15" y="5" width="6" height="14" rx="1.5" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                        <rect x="3" y="5" width="14" height="14" rx="2" />
                        <rect x="19" y="5" width="2.5" height="14" rx="0.75" />
                      </svg>
                    )}
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
              ) : !data ? (
                <div className="flex flex-col gap-3">
                  <div className="max-w-[95%] self-start rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[13px] leading-snug text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      {t.welcome}
                    </div>

                  {(gymHighEnergy ? ([0, 1, 2, 3, 4] as const) : ([0, 1, 2, 3] as const)).map((i) => {
                    const p = picks[i];
                    if (!p?.label || i >= Math.min(step, reviewStep)) return null;
                    const qBubble =
                      i === 3
                        ? styleQuestionLine
                        : gymHighEnergy && i === 4
                          ? finalStepQuestionLine
                          : t.questions[i as 0 | 1 | 2];
                    return (
                      <div key={`u-${i}`} className="flex flex-col gap-2">
                        <div className="max-w-[95%] self-start rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[13px] leading-snug text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                          {qBubble}
                        </div>
                        <div className="max-w-[92%] self-end rounded-2xl rounded-br-md border border-cyan-400/35 bg-gradient-to-br from-sky-500/16 to-cyan-500/12 px-3.5 py-2 text-[13px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                          {p.label}
                        </div>
                      </div>
                    );
                  })}

                  {step <= lastBubbleStep ? (
                    <>
                      <div className="max-w-[95%] self-start rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[13px] leading-snug text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                        {step === 3
                          ? styleQuestionLine
                          : gymHighEnergy && step === 4
                            ? finalStepQuestionLine
                            : t.questions[step as 0 | 1 | 2]}
                      </div>
                      <p className="text-[10px] text-slate-500">{t.tapOne}</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {currentStepBubbles.map((b, btnIdx) => (
                          <button
                            key={`${step}-bubble-${btnIdx}-${b.id}`}
                            type="button"
                            onClick={() => pickBubble(b, step)}
                            className="min-h-[2.5rem] rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-start text-[13px] font-medium leading-snug text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-cyan-400/45 hover:bg-cyan-500/[0.1] active:scale-[0.99]"
                          >
                            {bubbleLabel(b, he)}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="max-w-[95%] self-start rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[13px] leading-snug text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                        {t.addNoteQ}
                        <span className="mt-2 block text-[11px] text-slate-500">{t.addNoteHint}</span>
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
              ) : !catalogSufficient ? (
                <>
                  <div className="mb-3 rounded-xl border border-amber-500/35 bg-amber-950/30 px-3 py-3" role="status">
                    <p className="text-[13px] font-semibold text-amber-100">{t.weakCatalogTitle}</p>
                    <p className="mt-1 text-[11px] leading-snug text-amber-100/88">{t.weakCatalogBody}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      resetWizard();
                    }}
                    className={`w-full min-h-[2.5rem] px-3 text-[13px] font-semibold ${accentBtn}`}
                  >
                    {t.tryAdjustChoices}
                  </button>
                  <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
                    <p className="text-[11px] leading-snug text-slate-400">{t.requestEditorLead}</p>
                    <textarea
                      value={editorNote}
                      onChange={(e) => setEditorNote(e.target.value)}
                      rows={3}
                      placeholder={t.requestEditorPlaceholder}
                      className="mt-2 max-h-32 min-h-[4rem] w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
                      dir="auto"
                    />
                    <button
                      type="button"
                      disabled={editorBusy}
                      onClick={() => void submitEditorRequest()}
                      className="mt-2 w-full rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-3 py-2.5 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/[0.18] disabled:opacity-50"
                    >
                      {editorBusy ? t.requestEditorSubmitBusy : t.requestEditorSubmit}
                    </button>
                    {editorStatus === "ok" ? (
                      <p className="mt-2 text-[11px] text-emerald-300">{t.requestEditorThanks}</p>
                    ) : null}
                    {editorStatus === "err" ? (
                      <p className="mt-2 text-[11px] text-rose-300">{t.requestEditorError}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={resetWizard}
                    className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-[12px] font-medium text-slate-300 hover:bg-white/[0.08]"
                  >
                    {t.startOver}
                  </button>
                </>
              ) : (
                <>
                  <div className="mb-3 border-b border-white/8 pb-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t.suggestedPlaylist}</p>
                      <p className="mt-1 break-words text-base font-semibold text-white">
                        {playlistName.trim() ? playlistName.trim() : t.untitled}
                      </p>
                      <p className="mt-2 text-[11px] text-slate-400">
                        <span className="font-medium text-cyan-200/95">{t.fromCatalog}</span>
                        <span className="text-slate-600"> · </span>
                        <span className="text-slate-300">
                          {draftRows.length} {t.setsFromCatalog}
                        </span>
                        {draftDurationEstimate ? (
                          <>
                            <span className="text-slate-600"> · </span>
                            <span>{he ? fmtTotalDuration(draftDurationEstimate) : fmtTotalDurationEn(draftDurationEstimate)}</span>
                          </>
                        ) : draftRows.length > 0 ? (
                          <>
                            <span className="text-slate-600"> · </span>
                            <span className="text-slate-500">{he ? "אורך כולל לא זמין" : "length estimate N/A"}</span>
                          </>
                        ) : null}
                      </p>
                      <p className="mt-1.5 text-[10px] text-slate-500">{t.draftHint}</p>
                    </div>
                  </div>

                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t.picksHeading}{" "}
                    <span className="font-normal text-slate-600">({effectiveResultCap} max)</span>
                  </h3>

                  <ul className="mt-2 space-y-2">
                    {draftRows.length === 0 ? (
                      <li className="text-[13px] text-slate-500">{t.noSets}</li>
                    ) : (
                      draftRows.map((r, idx) => (
                        <li
                          key={`draft-${idx}-${r.catalogItemId}`}
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                        >
                          <div className="flex gap-2">
                            <span className="w-5 shrink-0 text-center text-[10px] text-slate-500">{idx + 1}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-100">{r.title}</p>
                              <p className="mt-1 text-[10px] text-slate-500">
                                {fmtDuration(r.durationSec)}
                                <span className="mx-1 text-slate-600">·</span>
                                SYNC <span className="tabular-nums text-slate-400">{r.curationRating}</span>
                              </p>
                              {r.matchedTags.length > 0 ? (
                                <p className="mt-1 text-[10px] text-cyan-200/80">{r.matchedTags.join(" · ")}</p>
                              ) : null}
                              <p className="mt-1.5 text-[11px] text-slate-500">{shortReason(r.recommendedBecause)}</p>
                            </div>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>

                  {lastSavedPlaylistId ? (
                    <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2.5" role="status">
                      <p className="text-[11px] leading-relaxed text-emerald-100/95">{t.savedLocationLine}</p>
                      <Link
                        href={`/playlists/${encodeURIComponent(lastSavedPlaylistId)}/edit`}
                        className={`mt-2 inline-flex min-h-[2.25rem] items-center justify-center rounded-xl px-3 text-[12px] font-semibold ${accentBtn}`}
                      >
                        {t.openPlaylistLink}
                      </Link>
                    </div>
                  ) : null}

                  {draftRows.length > 0 ? (
                    <div className="mt-4 space-y-1.5 border-t border-white/8 pt-4">
                      {DJ_CREATOR_SAVE_PLAYLIST_ENABLED ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSaveMessage(null);
                            setLastSavedPlaylistId(null);
                            setSaveOpen(true);
                          }}
                          className={`w-full px-4 py-2.5 text-[12px] font-semibold ${accentBtn}`}
                        >
                          {t.savePlaylist}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="w-full rounded-xl border border-slate-600 px-3 py-2.5 text-[12px] text-slate-500"
                        >
                          {t.saveSoon}
                        </button>
                      )}
                      <p className="text-[10px] text-slate-500">{t.saveActionsFootnote}</p>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={resetWizard}
                    className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-[12px] font-medium text-slate-300 hover:bg-white/[0.08]"
                  >
                    {t.startOver}
                  </button>
                </>
              )}
            </div>

            {tab === "chat" && (!data || !catalogSufficient) ? (
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
                  <textarea
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    rows={2}
                    placeholder={t.composerPlaceholder}
                    className="max-h-24 min-h-[2.5rem] w-full resize-y bg-transparent px-2 py-1 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
                    dir="auto"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={loading || step < reviewStep}
                      onClick={() => void runSearch()}
                      className={`flex-1 min-h-[2.5rem] px-3 text-[13px] disabled:opacity-40 ${accentBtn}`}
                    >
                      {loading ? t.getPicksLoading : t.getPicks}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <nav className="flex shrink-0 gap-1 border-t border-white/8 bg-[#0c0e14] p-1.5" aria-label="DJ Creator AI panels">
              <button
                type="button"
                onClick={() => setTab("chat")}
                className={`flex-1 rounded-xl py-2.5 text-center text-[12px] font-semibold ${
                  tab === "chat" ? `${accentBtn} shadow-none` : "border border-transparent text-slate-500 hover:bg-white/[0.06]"
                }`}
              >
                {t.tabChat}
              </button>
              <button
                type="button"
                onClick={() => setTab("guide")}
                className={`flex-1 rounded-xl py-2.5 text-center text-[12px] font-semibold ${
                  tab === "guide" ? `${accentBtn} shadow-none` : "border border-transparent text-slate-500 hover:bg-white/[0.06]"
                }`}
              >
                {t.tabGuide}
              </button>
            </nav>

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
                        className={`flex-1 min-h-[2.5rem] text-[13px] ${accentBtn} disabled:opacity-50`}
                      >
                        {saveBusy ? t.saving : t.saveBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSaveOpen(false)}
                        className="rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-slate-300 hover:bg-white/10"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
