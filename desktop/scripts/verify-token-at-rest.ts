/**
 * C6b — unit test for at-rest token sealing with the SEAL-OR-FAIL contract (never plaintext).
 * Covers SUCCESS and FAILURE paths:
 *  - success: seal/open round-trip, legacy seamless load, one-time migration (idempotent), empty token.
 *  - failure: encryption unavailable → a NEW token is NEVER written in cleartext; an existing token (sealed or
 *    legacy) is PRESERVED, not overwritten/blanked; tokenPersisted=false; a legacy-plaintext-remains WARN fires
 *    (without the token value); migration of a legacy token when protection is unavailable is recorded, not forced.
 *  - durability: atomic write leaves no partial file / no leftover .tmp; a save that fails mid-write leaves the
 *    PREVIOUS file intact and throws (no false success); a corrupt file on restart recovers without crashing.
 *
 * Uses a FAKE cipher mirroring the DPAPI contract (base64 instead of DPAPI). Run: npx tsx desktop/scripts/verify-token-at-rest.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveRuntimeConfig,
  loadRuntimeConfig,
  setTokenCipher,
  setConfigWarnLogger,
  migrateTokenAtRestIfNeeded,
} from "../src/main/runtime-config-service";
import { identityTokenCipher, TOKEN_SEAL_MAGIC, type TokenCipher } from "../src/main/token-at-rest";
import type { DesktopRuntimeConfig } from "../src/shared/mvp-types";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}

const CONFIG_NAME = "syncbiz-player-runtime.json";
const base = mkdtempSync(path.join(tmpdir(), "vono-tok-"));

// Capture WARNs (messages only — the module must never pass a token value here).
let warns: string[] = [];
setConfigWarnLogger((m) => warns.push(m));

/** Fake DPAPI cipher: seal→string|null (never plaintext), reversible base64, same contract as electronTokenCipher. */
function fakeCipher(opts: { available?: boolean; failOpen?: boolean } = {}): TokenCipher {
  const available = opts.available ?? true;
  return {
    available: () => available,
    isSealed: (s) => typeof s === "string" && s.startsWith(TOKEN_SEAL_MAGIC),
    seal: (p) => (!p ? "" : !available ? null : TOKEN_SEAL_MAGIC + Buffer.from(p, "utf8").toString("base64")),
    open: (s) => {
      if (typeof s !== "string") return "";
      if (!s.startsWith(TOKEN_SEAL_MAGIC)) return s;
      if (!available || opts.failOpen) return "";
      return Buffer.from(s.slice(TOKEN_SEAL_MAGIC.length), "base64").toString("utf8");
    },
  };
}
function cfg(dir: string, wsToken: string): DesktopRuntimeConfig {
  return {
    deviceId: "dsk-x", branchId: "default", workspaceLabel: "", apiBaseUrl: "https://a", wsUrl: "wss://a",
    wsToken, musicFolderPath: path.join(dir, "music"), // set so load() never triggers the music-folder heal + re-save
  };
}
function ud(name: string): string { const d = path.join(base, name); mkdirSync(d, { recursive: true }); return d; }
function rawToken(dir: string): string {
  const data = JSON.parse(readFileSync(path.join(dir, CONFIG_NAME), "utf-8")) as { wsToken?: string };
  return typeof data.wsToken === "string" ? data.wsToken : "";
}
function writeRaw(dir: string, c: DesktopRuntimeConfig): void {
  writeFileSync(path.join(dir, CONFIG_NAME), JSON.stringify(c, null, 2), "utf-8");
}

// ── SUCCESS: seal / open round-trip ──
setTokenCipher(fakeCipher());
{
  const d = ud("sealed");
  const res = saveRuntimeConfig(d, cfg(d, "tok-secret"));
  assert("success: result.tokenPersisted=true", res.tokenPersisted === true && res.legacyPlaintextRemains === false);
  assert("success: on-disk is SEALED (not plaintext)", rawToken(d).startsWith(TOKEN_SEAL_MAGIC) && rawToken(d) !== "tok-secret");
  assert("success: load decrypts to plaintext", loadRuntimeConfig(d).wsToken === "tok-secret");
  assert("success: no leftover .tmp, file is valid JSON (atomic)", !existsSync(path.join(d, CONFIG_NAME + ".tmp")) && readdirSync(d).includes(CONFIG_NAME));
}

// ── SUCCESS: empty token clears, reports persisted ──
{
  const d = ud("empty");
  const res = saveRuntimeConfig(d, cfg(d, ""));
  assert("empty: on-disk '' and tokenPersisted=true", rawToken(d) === "" && res.tokenPersisted === true);
}

// ── FAILURE: no protection → NEW token never written in cleartext ──
setTokenCipher(fakeCipher({ available: false }));
{
  const d = ud("noproto-fresh");
  warns = [];
  const res = saveRuntimeConfig(d, cfg(d, "should-not-persist"));
  assert("no-proto, no existing: NEW token NOT written as plaintext", rawToken(d) === "" && rawToken(d) !== "should-not-persist");
  assert("no-proto, no existing: tokenPersisted=false", res.tokenPersisted === false);
  assert("no-proto: a WARN fired and it carries NO token value", warns.length >= 1 && !warns.join("|").includes("should-not-persist"));
}

// ── FAILURE: no protection → existing SEALED token is PRESERVED, not overwritten/blanked ──
{
  const d = ud("noproto-existing-sealed");
  setTokenCipher(fakeCipher());                           // seal an existing token on this "machine"
  saveRuntimeConfig(d, cfg(d, "old-sealed"));
  const sealedBefore = rawToken(d);
  setTokenCipher(fakeCipher({ available: false }));        // now protection is gone
  const res = saveRuntimeConfig(d, cfg(d, "new-token"));   // try to save a DIFFERENT token
  assert("no-proto: existing SEALED token preserved (not overwritten)", rawToken(d) === sealedBefore);
  assert("no-proto: new token NOT on disk in any form", !rawToken(d).includes(Buffer.from("new-token").toString("base64")) && rawToken(d) !== "new-token");
  assert("no-proto: tokenPersisted=false (no false success)", res.tokenPersisted === false);
}

// ── FAILURE + MIGRATION: legacy plaintext + no protection → preserved, WARN "legacy remains", not migrated ──
{
  const d = ud("legacy-noproto");
  writeRaw(d, cfg(d, "legacy-plain"));
  setTokenCipher(fakeCipher({ available: false }));
  warns = [];
  assert("legacy+no-proto: load still returns the plaintext (station keeps working)", loadRuntimeConfig(d).wsToken === "legacy-plain");
  assert("legacy+no-proto: migration is NOT forced (returns false)", migrateTokenAtRestIfNeeded(d) === false);
  assert("legacy+no-proto: legacy plaintext still on disk (not deleted)", rawToken(d) === "legacy-plain");
  assert("legacy+no-proto: an explicit 'legacy ... remains' WARN fired, no token value", warns.some((w) => /legacy/i.test(w)) && !warns.join("|").includes("legacy-plain"));
}

// ── SUCCESS MIGRATION: legacy plaintext + protection → seals; idempotent ──
{
  const d = ud("legacy-migrate");
  writeRaw(d, cfg(d, "legacy2"));
  setTokenCipher(fakeCipher());
  assert("migrate: legacy + protection → migrates (true)", migrateTokenAtRestIfNeeded(d) === true);
  assert("migrate: on-disk now sealed", rawToken(d).startsWith(TOKEN_SEAL_MAGIC));
  assert("migrate: load still returns the same plaintext", loadRuntimeConfig(d).wsToken === "legacy2");
  assert("migrate: second run is a no-op", migrateTokenAtRestIfNeeded(d) === false);
}

// ── DURABILITY: a save that FAILS mid-write leaves the PREVIOUS file intact and throws (no false success) ──
{
  const d = ud("savefail");
  setTokenCipher(fakeCipher());
  // Pre-write a known-good file directly, then block the atomic tmp path with a DIRECTORY so write/rename fails.
  writeRaw(d, cfg(d, "good-before"));
  const before = readFileSync(path.join(d, CONFIG_NAME), "utf-8");
  mkdirSync(path.join(d, CONFIG_NAME + ".tmp"), { recursive: true });
  let threw = false;
  try { saveRuntimeConfig(d, cfg(d, "new-after")); } catch { threw = true; }
  assert("save-fail: saveRuntimeConfig THREW (did not report a save that didn't happen)", threw === true);
  assert("save-fail: the PREVIOUS file is byte-for-byte intact", readFileSync(path.join(d, CONFIG_NAME), "utf-8") === before);
  rmSync(path.join(d, CONFIG_NAME + ".tmp"), { recursive: true, force: true });
}

// ── DURABILITY: a CORRUPT file on restart recovers without crashing ──
{
  const d = ud("corrupt");
  writeFileSync(path.join(d, CONFIG_NAME), "{ this is : not json ", "utf-8"); // truncated / garbage
  let ok = false, loaded;
  try { loaded = loadRuntimeConfig(d); ok = true; } catch { ok = false; }
  assert("restart-after-fault: corrupt file → load recovers (no crash)", ok === true && typeof loaded!.deviceId === "string");
}

// ── identity cipher: cannot seal (never plaintext), passthrough open for legacy ──
{
  const id = identityTokenCipher();
  assert("identity: available=false, seal(real)=null (never plaintext), seal('')='' , open passthrough",
    id.available() === false && id.seal("tok") === null && id.seal("") === "" && id.open("legacy") === "legacy");
}

try { rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode ?? 0);
