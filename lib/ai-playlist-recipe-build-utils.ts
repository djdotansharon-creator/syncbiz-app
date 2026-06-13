/** Pure helpers for multi-lane AI playlist recipe build (no server imports). */

export type RecipeLanePick =
  | { kind: "catalog"; row: { catalogItemId: string; displayScore: number } }
  | { kind: "local"; candidate: { localId: string; score: number } };

/** Evenly distribute `total` tracks across `laneCount` lanes (remainder to first lanes). */
export function allocateLaneQuotas(total: number, laneCount: number): number[] {
  if (laneCount <= 0) return [];
  const safeTotal = Math.max(0, total);
  const base = Math.floor(safeTotal / laneCount);
  const remainder = safeTotal % laneCount;
  return Array.from({ length: laneCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Round-robin merge: lane1, lane2, lane3, lane1, lane2, lane3… */
export function interleaveLanePicks<T extends RecipeLanePick>(
  lanePicks: T[][],
  targetMax: number,
): T[] {
  const out: T[] = [];
  let round = 0;
  while (out.length < targetMax) {
    let any = false;
    for (const lane of lanePicks) {
      if (out.length >= targetMax) break;
      const pick = lane[round];
      if (pick) {
        out.push(pick);
        any = true;
      }
    }
    if (!any) break;
    round += 1;
  }
  return out;
}

export function lanePickScore(p: RecipeLanePick): number {
  return p.kind === "catalog" ? p.row.displayScore : p.candidate.score;
}
