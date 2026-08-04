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
import { isKnownLocale, DEFAULT_LOCALE, type Locale } from "@/lib/locales";

export type { Locale };

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = "syncbiz-locale";

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = localStorage.getItem(STORAGE_KEY);
  return isKnownLocale(stored) ? stored : DEFAULT_LOCALE;
}

function setLocaleCookie(locale: Locale) {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale};path=/;max-age=31536000;SameSite=Lax`;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored);
    setLocaleCookie(stored);
    document.documentElement.lang = stored;
    // Layout stays LTR for every language — only the text changes (owner directive).
    document.documentElement.dir = "ltr";
  }, []);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, next);
        setLocaleCookie(next);
        document.documentElement.lang = next;
        document.documentElement.dir = "ltr"; // always LTR — only text localizes
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
  architecture: { en: "Architecture", he: "ארכיטקטורה" },
  playlists: { en: "Playlists", he: "פלייליסטים" },
  library: { en: "Library", he: "ספרייה" },
  favorites: { en: "Favorites", he: "מועדפים" },
  radio: { en: "Radio", he: "רדיו" },
  remote: { en: "Remote", he: "שלט רחוק" },
  remotePlayer: { en: "Remote Player", he: "נגן מרוחק" },
  owner: { en: "Owner", he: "בעלים" },
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
