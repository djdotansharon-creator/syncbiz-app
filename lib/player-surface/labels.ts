/** Provider label shared by browser PlayerPage and desktop hero. */

export function providerLabelFromType(typ: string | null | undefined): string {
  const t = (typ ?? "").trim().toLowerCase();
  if (t === "youtube") return "YouTube";
  if (t === "soundcloud") return "SoundCloud";
  if (!t || t === "—") return "—";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
