/** The first letter of a name for the signed-in disc ("דוד כהן" → "ד", "dotan" → "D", "a@b.com" → "A"); "" when there is nothing sensible to show (empty, an emoji, a symbol). */
export function initialOf(name: string | null | undefined): string {
  const first = Array.from((name ?? "").trim())[0] ?? "";
  return /[\p{L}\p{N}]/u.test(first) ? first.toLocaleUpperCase() : "";
}
