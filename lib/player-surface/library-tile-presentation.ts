import { classifyLibraryEntityContract, type UnifiedSource } from "@/lib/source-types";

/**
 * Chooses SourceCard shell: `rich` = custom art / derived SyncBiz playlist covers;
 * `branch` = shared `BranchLibraryBrowseCard` shell (aligned with desktop branch library).
 */
export function libraryTilePresentationForUnifiedSource(source: UnifiedSource): "rich" | "branch" {
  if (source.origin !== "playlist") return "branch";
  const contract = classifyLibraryEntityContract(source);
  const isSyncbizCollection =
    contract.entityKind === "collection" && contract.collectionSubtype === "syncbiz_playlist";
  return isSyncbizCollection ? "rich" : "branch";
}
