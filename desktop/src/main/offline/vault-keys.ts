/**
 * OFFLINE VAULT — the machine MASTER key (stage A). The key itself never touches the disk in plaintext: it is stored
 * "protected" by the injected protector. In VONO MAIN the protector is Electron `safeStorage` (Windows DPAPI → bound to this
 * Windows user on this machine; copied to another PC the file is useless). Tests inject an identity protector.
 *
 * If the stored key cannot be unprotected (another Windows user, a reinstalled OS profile, a corrupt file) the vault is
 * UNUSABLE, never "half usable": the caller gets `null` and must stream instead (fail-safe) and later re-download.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type KeyProtector = {
  /** true when the OS protection is available (Electron: safeStorage.isEncryptionAvailable()). */
  available: () => boolean;
  protect: (plain: Buffer) => Buffer;
  unprotect: (sealed: Buffer) => Buffer;
};

const KEY_FILE = "vault.key";
const KEY_FILE_MAGIC = "VONOKEY1:";

/**
 * Load the master key, creating it on first use. Returns null when protection is unavailable or the stored key cannot
 * be unprotected (never throws; never overwrites an existing key it could not read — that would orphan the stored songs
 * silently; the caller decides to wipe + re-download).
 */
export function loadOrCreateMasterKey(dir: string, protector: KeyProtector): { key: Buffer; created: boolean } | null {
  try {
    if (!protector.available()) return null;
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, KEY_FILE);
    if (existsSync(file)) {
      const txt = readFileSync(file, "utf8").trim();
      if (!txt.startsWith(KEY_FILE_MAGIC)) return null;
      const key = protector.unprotect(Buffer.from(txt.slice(KEY_FILE_MAGIC.length), "base64"));
      return key.length === 32 ? { key, created: false } : null;
    }
    const key = randomBytes(32);
    const sealed = protector.protect(key);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, KEY_FILE_MAGIC + sealed.toString("base64"), { encoding: "utf8" });
    renameSync(tmp, file);
    return { key, created: true };
  } catch {
    return null;
  }
}

/** Electron safeStorage (DPAPI on Windows) as a KeyProtector. Imported lazily so this module stays testable in plain Node. */
export function electronSafeStorageProtector(): KeyProtector {
  // A local structural type, NOT `typeof import("electron")`: the root scripts/ type-check this file during the web app's
  // `next build`, where the electron package is not installed (PROD deploy 497456f3 failed on exactly that, 2026-11-11).
  type SafeStorage = { isEncryptionAvailable(): boolean; encryptString(plain: string): Buffer; decryptString(sealed: Buffer): string };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { safeStorage } = require("electron") as { safeStorage: SafeStorage };
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    protect: (plain) => safeStorage.encryptString(plain.toString("base64")),
    unprotect: (sealed) => Buffer.from(safeStorage.decryptString(sealed), "base64"),
  };
}
