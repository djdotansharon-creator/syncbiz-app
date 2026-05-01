/**
 * Stage 6.2A — BPM bands derived from manual CatalogItem energy (display only; not used in scoring).
 */

const BPM_BY_LEVEL: Record<number, string> = {
  1: "60–90 BPM",
  2: "80–100 BPM",
  3: "90–110 BPM",
  4: "100–115 BPM",
  5: "110–122 BPM",
  6: "120–126 BPM",
  7: "124–130 BPM",
  8: "128–138 BPM",
  9: "135–145 BPM",
  10: "145+ BPM · Peak / extreme energy",
};

/** Human-readable BPM hint for energy 1–10; null if unset or out of range. */
export function bpmRangeLabelForManualEnergy(level: number | null | undefined): string | null {
  if (level == null || !Number.isInteger(level)) return null;
  return BPM_BY_LEVEL[level] ?? null;
}

export function isValidManualEnergyRating(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}
