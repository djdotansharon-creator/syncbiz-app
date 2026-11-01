"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE_NAME } from "@/lib/constants";
import { getTranslations } from "@/lib/translations";
import { isKnownLocale, DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/locales";

export type { Locale };

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = "syncbiz-locale";
const isRtlLocale = (l: Locale) => !!LOCALES.find((x) => x.code === l)?.rtl;

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = localStorage.getItem(STORAGE_KEY);
  return isKnownLocale(stored) ? stored : DEFAULT_LOCALE;
}

function setLocaleCookie(locale: Locale) {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale};path=/;max-age=31536000;SameSite=Lax`;
}

/** `initialLocale` = what the SERVER already rendered the page in (the locale cookie): the first paint is then in the saved language and nothing flips from English once the page wakes up (owner 2026-11-01: "check Hebrew"). Default "en" = the old behaviour for every other use. */
export function LocaleProvider({ children, initialLocale = "en" }: { children: ReactNode; initialLocale?: Locale }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored);
    setLocaleCookie(stored);
    document.documentElement.lang = stored;
    // owner 2026-10-20: Hebrew / Arabic mirror the whole interface (the server already rendered this direction)
    document.documentElement.dir = isRtlLocale(stored) ? "rtl" : "ltr";
  }, []);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, next);
        setLocaleCookie(next);
        document.documentElement.lang = next;
        document.documentElement.dir = isRtlLocale(next) ? "rtl" : "ltr";
        router.refresh();
      }
    },
    [router],
  );

  const value = useMemo(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  return ctx ?? { locale: "en" as Locale, setLocale: () => {} };
}

/** Use in client components for full translations. */
export function useTranslations() {
  const { locale } = useLocale();
  const t = useMemo(() => getTranslations(locale), [locale]);
  return { t, locale };
}

export const labels: Record<string, { en: string; he: string }> = {
  dashboard: { en: "Dashboard", he: "לוח בקרה" },
  player: { en: "Player", he: "נגן" },
  devices: { en: "Devices", he: "מכשירים" },
  sources: { en: "Sources", he: "מקורות" },
  schedules: { en: "Schedules", he: "לוח זמנים" },
  announcements: { en: "Announcements", he: "הכרזות" },
  logs: { en: "Logs", he: "לוגים" },
  settings: { en: "Settings", he: "הגדרות" },
  "access-control": { en: "Access Control", he: "בקרת גישה" },
  jingles: { en: "Jingles", he: "ג'ינגלים" },
  "display-design": { en: "Lock screen design", he: "עיצוב מסך נעילה" },
  architecture: { en: "Architecture", he: "ארכיטקטורה" },
  playlists: { en: "Playlists", he: "פלייליסטים" },
  library: { en: "Library", he: "ספרייה" },
  favorites: { en: "Favorites", he: "מועדפים" },
  radio: { en: "Radio", he: "רדיו" },
  remote: { en: "Remote", he: "שלט רחוק" },
  remotePlayer: { en: "Remote Player", he: "נגן מרוחק" },
  owner: { en: "Owner", he: "בעלים" },
  controlRoom: { en: "Control Room", he: "חדר בקרה" },
  headerSubtitle: {
    en: "Schedule playback and send commands to endpoint devices",
    he: "תזמן השמעה ושלוח פקודות למכשירי קצה",
  },
};

export function useLabel(key: keyof typeof labels): string {
  const { locale } = useLocale();
  const pair = labels[key];
  if (!pair) return String(key);
  // Only en/he are authored here; every other locale falls back to English.
  return (pair as Record<string, string>)[locale] ?? pair.en;
}
