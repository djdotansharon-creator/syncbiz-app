/**
 * Deterministic regression for SHUFFLE/RANDOM persistence + reload (layers B/C/D of the shuffle audit).
 *
 * Field (Lenovo): shuffle ON → reboot → resumes playback but RANDOM button came back OFF. This asserts
 * the persistence contract the provider relies on: setShufflePreference writes it, getShuffle reads it,
 * and a "reboot" (fresh read from the same localStorage) returns the last written value — ON stays ON,
 * OFF stays OFF. Uses an in-memory localStorage that survives across reads (models Electron on-disk
 * localStorage surviving a Windows reboot).
 *
 * Run: npx tsx scripts/verify-shuffle-persistence.ts
 */
// In-memory localStorage that persists for the whole run (models on-disk localStorage across reboot).
const store = new Map<string, string>();
const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
g.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
g.window = g; // make `typeof window !== "undefined"` true so the client-only guards run

import { getShuffle, setShufflePreference } from "@/lib/mix-preferences";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const KEY = "syncbiz-shuffle";
/** Model "the provider mounts after a reboot": it reads getShuffle() to seed state.shuffle. */
const rebootStateShuffle = (): boolean => getShuffle();

// ── write → read round-trip ───────────────────────────────────────────────────
setShufflePreference(true);
assert("set(true) writes '1'", store.get(KEY) === "1", store.get(KEY));
assert("get() reflects true", getShuffle() === true);

setShufflePreference(false);
assert("set(false) writes '0'", store.get(KEY) === "0", store.get(KEY));
assert("get() reflects false", getShuffle() === false);

// ── REQUIRED: SHUFFLE ON → reboot → still ON ──────────────────────────────────
setShufflePreference(true);
assert("REQUIRED: shuffle ON → reboot → provider seeds state.shuffle = true", rebootStateShuffle() === true);

// ── REQUIRED: SHUFFLE OFF → reboot → still OFF ────────────────────────────────
setShufflePreference(false);
assert("REQUIRED: shuffle OFF → reboot → provider seeds state.shuffle = false", rebootStateShuffle() === false);

// ── parsing tolerance (never throws; unknown/absent ⇒ false) ──────────────────
store.set(KEY, "true"); assert("get() parses legacy 'true'", getShuffle() === true);
store.set(KEY, "TRUE"); assert("get() parses 'TRUE' (case-insensitive)", getShuffle() === true);
store.set(KEY, "1");    assert("get() parses '1'", getShuffle() === true);
store.set(KEY, "0");    assert("get() parses '0' → false", getShuffle() === false);
store.set(KEY, "yes");  assert("get() unknown value → false (not truthy-by-accident)", getShuffle() === false);
store.delete(KEY);       assert("get() absent key → false (default OFF)", getShuffle() === false);

// ── idempotent re-write, and no cross-talk with other keys ────────────────────
store.clear();
setShufflePreference(true); setShufflePreference(true);
assert("idempotent set(true) twice → still '1'", store.get(KEY) === "1" && getShuffle() === true);
assert("only the shuffle key was written", [...store.keys()].length === 1 && store.has(KEY));

console.log(`\n${pass} passed, ${fail} failed`);
