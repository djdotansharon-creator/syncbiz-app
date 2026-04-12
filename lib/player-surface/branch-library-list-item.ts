/** Shape used by shared branch library grid — matches `BranchLibraryItem` from desktop MVP types. */
export type BranchLibraryListItem = {
  id: string;
  title: string;
  origin: "playlist" | "radio" | "source";
  type: string;
  genre: string;
  cover: string | null;
};

export function branchLibraryItemMetaLine(it: BranchLibraryListItem): string {
  const g = it.genre?.trim() && it.genre !== "—" ? it.genre : "";
  return [g, it.type].filter(Boolean).join(" · ") || it.origin;
}
