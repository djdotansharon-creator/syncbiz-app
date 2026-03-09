import { cookies } from "next/headers";
import type { Locale } from "@/lib/locale-context";
import { LOCALE_COOKIE_NAME } from "@/lib/constants";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE_NAME)?.value;
  return value === "he" ? "he" : "en";
}
