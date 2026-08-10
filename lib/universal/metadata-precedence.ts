/**
 * Phase C — field-level metadata precedence.
 *
 * Order (highest wins): manual → excel → mp3 → external (youtube/spotify/soundcloud).
 * A re-scan of a LOWER-precedence source never overwrites a field a HIGHER-precedence
 * source set. Provenance is tracked per field so this stays honest across re-imports.
 */

export type MetadataSource = "manual" | "excel" | "mp3" | "youtube" | "spotify" | "soundcloud" | "external";

const PRECEDENCE: Record<MetadataSource, number> = {
  manual: 100,
  excel: 80,
  mp3: 60,
  youtube: 40,
  spotify: 40,
  soundcloud: 40,
  external: 20,
};

export function precedenceRank(source: MetadataSource | undefined): number {
  return source ? PRECEDENCE[source] : -1;
}

export interface MergeResult {
  values: Record<string, unknown>;
  provenance: Record<string, MetadataSource>;
  changed: string[];
}

/**
 * Merge `incoming` (all from one source) into `current`, respecting precedence. Empty/null
 * incoming values are ignored (never blank out an existing value). Equal-rank overwrites
 * (e.g. an mp3 re-scan updating an mp3-sourced field); lower rank is skipped.
 */
export function mergeMetadata(
  current: Record<string, unknown>,
  currentProvenance: Record<string, MetadataSource> | null | undefined,
  incoming: Record<string, unknown>,
  incomingSource: MetadataSource,
): MergeResult {
  const values: Record<string, unknown> = { ...current };
  const provenance: Record<string, MetadataSource> = { ...(currentProvenance ?? {}) };
  const changed: string[] = [];
  const inRank = PRECEDENCE[incomingSource];

  for (const [field, val] of Object.entries(incoming)) {
    if (val === null || val === undefined || val === "") continue;
    if (Array.isArray(val) && val.length === 0) continue;
    if (inRank < precedenceRank(provenance[field])) continue; // lower precedence → keep existing
    const prev = values[field];
    if (JSON.stringify(prev) !== JSON.stringify(val)) changed.push(field);
    values[field] = val;
    provenance[field] = incomingSource;
  }
  return { values, provenance, changed };
}
