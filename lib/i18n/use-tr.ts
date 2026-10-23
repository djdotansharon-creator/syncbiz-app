"use client";

import { useCallback } from "react";
import { useLocale } from "@/lib/locale-context";
import { trFor } from "@/lib/i18n/phrases";

/** `const tr = useTr();` then `tr("All jingles")` — Hebrew when the interface is Hebrew, the English text otherwise (see lib/i18n/phrases.ts). */
export function useTr(): (text: string, vars?: Record<string, string | number>) => string {
  const { locale } = useLocale();
  return useCallback((text: string, vars?: Record<string, string | number>) => trFor(locale, text, vars), [locale]);
}
