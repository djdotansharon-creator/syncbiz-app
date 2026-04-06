/**
 * Default local start times when opening Schedule from a daypart playlist tile (clock).
 * User convention: Morning 08:00, Afternoon 13:00, Evening 17:00, Night 21:00.
 */

const KEY_TO_START: Record<string, string> = {
  "daypart:morning": "08:00:00",
  "daypart:afternoon": "13:00:00",
  "daypart:evening": "17:00:00",
  "daypart:late_night": "21:00:00",
};

const LABEL_HINT: Array<{ match: RegExp; start: string }> = [
  { match: /\b(morning|בוקר)\b/i, start: "08:00:00" },
  { match: /\b(afternoon|צהר|צהריים)\b/i, start: "13:00:00" },
  { match: /\b(evening|ערב)\b/i, start: "17:00:00" },
  { match: /\b(night|לילה|late\s*night)\b/i, start: "21:00:00" },
];

/** `daypart:morning` etc. from playlist tile keys */
export function defaultStartTimeForDaypartKey(daypartKey: string): string | null {
  const k = daypartKey.trim().toLowerCase();
  return KEY_TO_START[k] ?? null;
}

/** Fallback when only a display label is available (custom tiles, i18n). */
export function defaultStartTimeForDaypartLabel(daypartLabel: string): string | null {
  const s = daypartLabel.trim();
  if (!s) return null;
  for (const { match, start } of LABEL_HINT) {
    if (match.test(s)) return start;
  }
  return null;
}

export function defaultStartTimeForScheduleModalContext(args: {
  daypartKey?: string;
  daypartLabel?: string;
}): string {
  const fromKey = args.daypartKey ? defaultStartTimeForDaypartKey(args.daypartKey) : null;
  if (fromKey) return fromKey;
  const fromLabel = args.daypartLabel ? defaultStartTimeForDaypartLabel(args.daypartLabel) : null;
  if (fromLabel) return fromLabel;
  return "09:00:00";
}
