/**
 * A small in-memory sliding-window limiter (owner 2026-11-23, sharing phase D: no one may hammer the "find a person by ID" lookup or flood another business with shares). SOFT by design: it lives in one server
 * process, so it slows an attacker down but is not the last line — the hard caps are counted in the database. Server only.
 */
const hits = new Map<string, number[]>();

/** true = allowed (and counted); false = over the limit for this key in the last `windowMs`. */
export function allowHit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const from = now - windowMs;
  const list = (hits.get(key) ?? []).filter((t) => t > from);
  if (list.length >= limit) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => t <= from)) hits.delete(k); // keep the map small
  return true;
}
