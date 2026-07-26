/**
 * Loader for the curated tag packs (client-safe — the JSON is bundled). Mirrors
 * load-fit-rules.ts: parse once, cache, expose the active packs + a seed-slug index.
 */

import rawBundle from "./tag-packs.json";
import { parseTagPacksBundle, type TagPack } from "./tag-packs.types";

let cachedActive: TagPack[] | null = null;

/** All ACTIVE packs (validated; malformed rows dropped). */
export function loadTagPacks(): TagPack[] {
  if (!cachedActive) {
    cachedActive = parseTagPacksBundle(rawBundle).packs.filter((p) => p.isActive);
  }
  return cachedActive;
}

/** Index: seed slug -> packs whose seedTagSlugs include it. */
export function packsBySeedSlug(packs: readonly TagPack[]): Map<string, TagPack[]> {
  const idx = new Map<string, TagPack[]>();
  for (const pack of packs) {
    for (const seed of pack.seedTagSlugs) {
      const arr = idx.get(seed) ?? [];
      arr.push(pack);
      idx.set(seed, arr);
    }
  }
  return idx;
}
