/**
 * Login / manager re-auth RATE LIMIT (owner 2026-10-13, security hotfix; softened by owner 2026-10-22). In-memory,
 * per server process: 10 failed attempts for the same ACCOUNT (20 for the same ADDRESS — an office shares one IP)
 * within 15 minutes → that key is blocked for 5 minutes (HTTP 429 + Retry-After).
 * A success clears the key. Keys are "<purpose>:<email>" and "<purpose>-ip:<ip>" so neither a single account nor a
 * single address can be brute-forced. (One Railway replica today; a multi-replica deploy would need a shared store.)
 */

export const RATE_MAX_FAILURES = 10;
export const RATE_MAX_FAILURES_IP = 20;
export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const RATE_BLOCK_MS = 5 * 60 * 1000;
const MAX_KEYS = 10_000;

type Entry = { failures: number[]; blockedUntil: number };
// one store per server process, even if Next bundles this module into several route chunks
const g = globalThis as unknown as { __vonoAuthRateStore?: Map<string, Entry> };
const store: Map<string, Entry> = (g.__vonoAuthRateStore ??= new Map<string, Entry>());

/** ms until the key may try again (0 = allowed now). */
export function retryAfterMs(key: string, now = Date.now()): number {
  const e = store.get(key);
  if (!e) return 0;
  return e.blockedUntil > now ? e.blockedUntil - now : 0;
}

/** Record a failed attempt; returns true when this failure triggered (or extends) a block. */
export function recordFailure(key: string, now = Date.now()): boolean {
  const e = store.get(key) ?? { failures: [], blockedUntil: 0 };
  e.failures = e.failures.filter((t) => now - t < RATE_WINDOW_MS);
  e.failures.push(now);
  if (e.failures.length >= (key.includes("-ip:") ? RATE_MAX_FAILURES_IP : RATE_MAX_FAILURES)) {
    e.blockedUntil = now + RATE_BLOCK_MS;
    e.failures = [];
  }
  store.delete(key); // re-insert = LRU order
  store.set(key, e);
  if (store.size > MAX_KEYS) store.delete(store.keys().next().value as string);
  return e.blockedUntil > now;
}

export function recordSuccess(key: string): void {
  store.delete(key);
}

/** The caller's address (Railway / proxies put the client first in x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for") ?? "";
  return (xff.split(",")[0] ?? "").trim() || headers.get("x-real-ip") || "unknown";
}

/** Keys checked for one attempt: the account and the address. */
export function attemptKeys(purpose: string, email: string, headers: Headers): string[] {
  return [`${purpose}:${email.trim().toLowerCase()}`, `${purpose}-ip:${clientIp(headers)}`];
}

/** Largest wait across keys (0 = allowed). */
export function blockedFor(keys: string[], now = Date.now()): number {
  return Math.max(0, ...keys.map((k) => retryAfterMs(k, now)));
}

/** Test helper. */
export function __resetRateLimit(): void {
  store.clear();
}
