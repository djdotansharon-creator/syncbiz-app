"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/locale-context";
import { mgmt, type Mgmt } from "@/lib/i18n/management";

/** Management strings + direction for the current locale (the existing locale switch drives it). */
export function useMgmt(): Mgmt {
  const { locale } = useLocale();
  return useMemo(() => mgmt(locale), [locale]);
}
