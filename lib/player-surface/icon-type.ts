import type { SourceIconType } from "@/lib/player-utils";

/** Map unified API / desktop type strings to shared hero icon. */
export function sourceTypeToIconType(typ: string | null | undefined): SourceIconType {
  const t = (typ ?? "").trim().toLowerCase();
  if (t === "youtube") return "youtube";
  if (t === "soundcloud") return "soundcloud";
  if (t === "local" || t === "file") return "local";
  return "external";
}
