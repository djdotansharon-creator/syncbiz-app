/** Top-left art badge — matches desktop branch grid + unified library cards. */
export type LibraryOriginKind = "playlist" | "radio" | "source";

export function libraryOriginBadgeLabel(origin: LibraryOriginKind): string {
  if (origin === "playlist") return "List";
  if (origin === "radio") return "Radio";
  return "Src";
}
