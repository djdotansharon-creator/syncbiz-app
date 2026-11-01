/**
 * Static checks for the Hebrew first paint (owner 2026-11-01: "check Hebrew"). The server already renders <html lang dir> from the locale cookie, but the app's own texts were drawn in English
 * until the page woke up and read the saved language. Run: npx tsx scripts/verify-locale-first-paint.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf-8");

const ctx = read("lib/locale-context.tsx");
const prov = read("app/(app)/providers.tsx");
const layout = read("app/(app)/layout.tsx");
const sm = read("components/sources-manager.tsx");
const smc = read("components/sources-manager-client.tsx");
const phrases = read("lib/i18n/phrases.ts");

assert("L1 the provider starts in the language the server rendered (initialLocale), and its default stays 'en' — every other use (the sign-in card, the computer-blocked notice) behaves exactly as before",
  /LocaleProvider\(\{ children, initialLocale = "en" \}: \{ children: ReactNode; initialLocale\?: Locale \}\)/.test(ctx) && /useState<Locale>\(initialLocale\)/.test(ctx) && !/useState<Locale>\("en"\)/.test(ctx));
assert("L2 it still reads the saved language afterwards and keeps <html lang dir> and the cookie in step (nothing of the old behaviour was removed)", /const stored = readStoredLocale\(\);\s*setLocaleState\(stored\);\s*setLocaleCookie\(stored\);/.test(ctx) && /document\.documentElement\.dir = isRtlLocale\(stored\)/.test(ctx));
assert("L3 the app layout reads the cookie on the SERVER (the same getLocale() the root layout uses for <html lang dir>) and hands it to the providers", /import \{ getLocale \} from "@\/lib\/locale-server";/.test(layout) && /const locale = await getLocale\(\);/.test(layout) && /<AppProviders locale=\{locale\}>/.test(layout) && /<LocaleProvider initialLocale=\{locale\}>/.test(prov));
assert("L4 the playlist counter in the right rail is translated and plural ('4 items' / '4 פריטים'), not a hard-coded English 'item'", /\{p\.itemCount\} \{tr\(p\.itemCount === 1 \? "item" : "items"\)\}/.test(sm) && /"item": "פריט",/.test(phrases) && /"items": "פריטים",/.test(phrases));
assert("L5 the 'Loading…' box that stands where the library will be (on screen in the first frame) is in the saved language", /useTranslations\(\)/.test(smc) && /\{t\.loadingSources\}/.test(smc) && !/>Loading…</.test(smc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
