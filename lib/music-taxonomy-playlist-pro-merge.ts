/**
 * Playlist Pro PDF enrichment — alias merges onto canonical taxonomy slugs (Stage 3 seed only).
 */

import fs from "node:fs";
import path from "node:path";

export type PlaylistProMergeConfig = {
  aliasMergeByLabel: Record<string, string>;
  hebrewLabelSlugOverrides: Record<string, string>;
};

let cached: PlaylistProMergeConfig | null = null;

export function loadPlaylistProMergeConfig(): PlaylistProMergeConfig {
  if (cached) return cached;
  const p = path.join(process.cwd(), "lib", "music-taxonomy-playlist-pro-merge-config.json");
  const raw = fs.readFileSync(p, "utf8");
  cached = JSON.parse(raw) as PlaylistProMergeConfig;
  return cached;
}

/** Labels extracted from Playlist Pro PDF → canonical slug (aliases appended at seed time). */
export function getPlaylistProAliasMergeEntries(): { labelEn: string; targetSlug: string }[] {
  const { aliasMergeByLabel } = loadPlaylistProMergeConfig();
  return Object.entries(aliasMergeByLabel).map(([labelEn, targetSlug]) => ({ labelEn, targetSlug }));
}
