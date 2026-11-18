/**
 * C6b SECURITY (2026-11-14) — at-rest protection for the station's signed `wsToken`.
 *
 * The desktop_access token lives in `syncbiz-player-runtime.json` (Electron userData). Until now it was stored as
 * PLAINTEXT; a stolen file (disk/backup access) let an attacker impersonate the station until the token expired.
 * This wraps it with Electron `safeStorage` (Windows DPAPI → bound to THIS Windows user on THIS machine; copied to
 * another PC/user the sealed value is useless), mirroring the existing offline-vault key pattern (`offline/vault-keys.ts`).
 *
 * Design (fail-SAFE — NEVER write a new token in cleartext, never lose a working one):
 *  - `seal(plain)`  → `MAGIC + base64(encrypt)` when encryption is available; `""` for an empty token; and `null`
 *                     when it CANNOT be sealed (no DPAPI / encrypt error). It NEVER returns plaintext. The save
 *                     layer, on a `null`, refuses to write cleartext and preserves the existing on-disk token.
 *  - `open(stored)` → a legacy plaintext value (no MAGIC) is returned as-is (seamless upgrade); a sealed value is
 *                     decrypted, or — when it cannot be opened (foreign machine/user, unavailable crypto, tamper) —
 *                     returns "" so the station cleanly RE-AUTHENTICATES instead of sending a garbage token. The
 *                     on-disk sealed blob is never overwritten on a failed open (the caller holds "" in memory only).
 *  - The IN-MEMORY and over-the-wire token is ALWAYS plaintext — server verification is unchanged.
 *
 * The default injected into the config service is `identityTokenCipher()` — it reports NO protection and therefore
 * cannot seal (so, unwired, a new token is never written in cleartext; the save layer preserves what is on disk).
 * VONO MAIN injects `electronTokenCipher()` at startup, before any token save.
 */

/** The marker that distinguishes a sealed token from a legacy plaintext one on disk. */
export const TOKEN_SEAL_MAGIC = "VONOTOK1:";

export type TokenCipher = {
  /** true when OS protection is available (Electron: safeStorage.isEncryptionAvailable()). */
  available: () => boolean;
  /** true when `stored` is an already-sealed value (carries the MAGIC prefix). */
  isSealed: (stored: string) => boolean;
  /** plaintext → sealed stored form; `""` for an empty token; `null` when it CANNOT be sealed (NEVER plaintext). */
  seal: (plain: string) => string | null;
  /** stored form → plaintext ("" when a sealed value cannot be opened; legacy plaintext returned as-is). */
  open: (stored: string) => string;
};

/**
 * No-protection cipher (default + no-DPAPI fallback). It reports unavailable and CANNOT seal — so a non-empty
 * token yields `null` (the save layer then refuses cleartext and keeps the existing on-disk value). A legacy
 * plaintext value still loads via `open` (passthrough), so nothing already on disk is lost; a SEALED value cannot
 * be opened here → "" (never handed out as a token).
 */
export function identityTokenCipher(): TokenCipher {
  return {
    available: () => false,
    // 2026-11-18: a value that carries the seal marker IS sealed even though this cipher cannot open it — it must never be mistaken for a plaintext token (it used to be returned as-is, i.e. a garbage
    // bearer token on any read before the real cipher was installed) and the save layer must recognise it so it is never overwritten with "".
    isSealed: (stored) => typeof stored === "string" && stored.startsWith(TOKEN_SEAL_MAGIC),
    seal: (plain) => (plain ? null : ""), // cannot seal a real token without protection → null (never plaintext)
    open: (stored) => (typeof stored === "string" && !stored.startsWith(TOKEN_SEAL_MAGIC) ? stored : ""),
  };
}

/**
 * Electron `safeStorage` (DPAPI on Windows) cipher. Imported LAZILY via `require("electron")` with a LOCAL structural
 * type — NOT `typeof import("electron")` — because root scripts type-check the desktop main tree during the web
 * app's `next build`, where the electron package is not installed (same reason as `offline/vault-keys.ts`).
 */
export function electronTokenCipher(): TokenCipher {
  type SafeStorage = {
    isEncryptionAvailable(): boolean;
    encryptString(plain: string): Buffer;
    decryptString(sealed: Buffer): string;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { safeStorage } = require("electron") as { safeStorage: SafeStorage };
  const available = (): boolean => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };
  return {
    available,
    isSealed: (stored) => typeof stored === "string" && stored.startsWith(TOKEN_SEAL_MAGIC),
    seal: (plain) => {
      if (!plain) return ""; // empty token → clear (not a secret)
      if (!available()) return null; // no DPAPI → cannot seal; the save layer must NOT write cleartext
      try {
        return TOKEN_SEAL_MAGIC + safeStorage.encryptString(plain).toString("base64");
      } catch {
        return null; // encrypt failure → signal "cannot seal" (never plaintext)
      }
    },
    open: (stored) => {
      if (typeof stored !== "string") return "";
      if (!stored.startsWith(TOKEN_SEAL_MAGIC)) return stored; // legacy plaintext → seamless
      try {
        if (!available()) return ""; // sealed but no crypto now → treat as no token (re-auth), never return the blob
        return safeStorage.decryptString(Buffer.from(stored.slice(TOKEN_SEAL_MAGIC.length), "base64"));
      } catch {
        return ""; // foreign machine/user / tampered → re-auth, do NOT surface a garbage token
      }
    },
  };
}
