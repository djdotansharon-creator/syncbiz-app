/**
 * The languages SyncBiz can display in. The i18n architecture is additive: only
 * `en` + `he` ship full translations today; every other locale renders through the
 * English fallback (see getTranslations) until its strings are filled in — so a
 * language can be offered in the picker WITHOUT any risk to the existing UI.
 *
 * `code` is the stored/cookie value; `name` is the language's own native name;
 * `flag` is an emoji flag; `rtl` drives document direction (Hebrew + Arabic).
 */
export const LOCALES = [
  { code: "en", name: "English", country: "us", rtl: false },
  { code: "he", name: "עברית", country: "il", rtl: true },
  { code: "ar", name: "العربية", country: "sa", rtl: true },
  { code: "es", name: "Español", country: "es", rtl: false },
  { code: "fr", name: "Français", country: "fr", rtl: false },
  { code: "de", name: "Deutsch", country: "de", rtl: false },
  { code: "it", name: "Italiano", country: "it", rtl: false },
  { code: "pt", name: "Português", country: "br", rtl: false },
  { code: "ru", name: "Русский", country: "ru", rtl: false },
  { code: "zh-Hans", name: "简体中文", country: "cn", rtl: false },
  { code: "zh-Hant", name: "繁體中文", country: "tw", rtl: false },
  { code: "ja", name: "日本語", country: "jp", rtl: false },
  { code: "ko", name: "한국어", country: "kr", rtl: false },
  { code: "hi", name: "हिन्दी", country: "in", rtl: false },
  { code: "id", name: "Indonesia", country: "id", rtl: false },
  { code: "th", name: "ไทย", country: "th", rtl: false },
  { code: "tl", name: "Tagalog", country: "ph", rtl: false },
  { code: "tr", name: "Türkçe", country: "tr", rtl: false },
  { code: "nl", name: "Nederlands", country: "nl", rtl: false },
  { code: "pl", name: "Polski", country: "pl", rtl: false },
  { code: "cs", name: "Čeština", country: "cz", rtl: false },
  { code: "da", name: "Dansk", country: "dk", rtl: false },
  { code: "sv", name: "Svenska", country: "se", rtl: false },
  { code: "no", name: "Norsk", country: "no", rtl: false },
  { code: "hu", name: "Magyar", country: "hu", rtl: false },
  { code: "ro", name: "Română", country: "ro", rtl: false },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";

const CODES = new Set<string>(LOCALES.map((l) => l.code));
const RTL = new Set<string>(LOCALES.filter((l) => l.rtl).map((l) => l.code));

export function isKnownLocale(v: unknown): v is Locale {
  return typeof v === "string" && CODES.has(v);
}

export function isRtlLocale(code: string): boolean {
  return RTL.has(code);
}

export function localeMeta(code: Locale) {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}
