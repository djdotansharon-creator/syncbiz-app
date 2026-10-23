/**
 * A soft colour for a saved jingle that is not on a coloured pad (owner 2026-10-20: "the jingles had a bit of colour" — library jingles were all the same grey).
 * Stable per jingle (hash of its id), picked from the pad palette so a tile looks like a pad of the same colour. Presentation only.
 */
const TINTS = ["#5ac8fa", "#bf5af2", "#ff6bb0", "#ffb340", "#ff6b81", "#40d0c0", "#a8e060", "#7d7aff"] as const;

export function jingleTint(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return TINTS[(h >>> 0) % TINTS.length]!;
}
