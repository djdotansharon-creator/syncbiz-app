/**
 * OFFLINE VAULT — crypto core (Music Bank Phase 2, stage A; owner 2026-11-10/11). PURE Node (no Electron) so it is testable.
 *
 * Locked model (memory: music-bank-streaming-offline-encryption-model.md): every downloaded song is stored ENCRYPTED on the
 * branch PC — playable only through VONO (no other player can open it; someone browsing the disk cannot use it).
 *
 *  - One MASTER key per machine (32 random bytes), stored wrapped by Windows DPAPI (vault-keys.ts) — never in plaintext.
 *  - A per-song KEY = HKDF-SHA256(master, salt "vono-offline-v1", info = opaque id). Nothing per song to store.
 *  - OPAQUE id = HMAC-SHA256(master, "asset:" + contentHash) → the file name; it does not reveal which song it is.
 *  - File = 32-byte header + chunks. Each chunk = AES-256-GCM(1 MiB plaintext) + 16-byte tag; nonce = 8 random header bytes
 *    + the chunk index (unique per chunk); AAD = header + chunk index + "last" flag → a chunk cannot be moved, swapped with
 *    another file's, or the file truncated / extended without the GCM check failing.
 *  - Any byte range decrypts by itself (only the chunks it touches) → MPV can seek and the loopback server answers Range.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export const MAGIC = Buffer.from("VONOENC1", "ascii");
export const FORMAT_VERSION = 1;
export const HEADER_LEN = 32;
export const TAG_LEN = 16;
export const DEFAULT_CHUNK = 1024 * 1024; // 1 MiB — bounded memory on a 4 GB branch PC

export type VaultHeader = { version: number; chunkSize: number; plainSize: number; noncePrefix: Buffer; raw: Buffer };

export function opaqueIdFor(master: Buffer, contentHash: string): string {
  return createHmac("sha256", master).update(`asset:${contentHash.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

export function assetKey(master: Buffer, opaqueId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.from("vono-offline-v1"), Buffer.from(opaqueId), 32));
}

export function buildHeader(plainSize: number, chunkSize = DEFAULT_CHUNK, noncePrefix = randomBytes(8)): VaultHeader {
  if (!Number.isSafeInteger(plainSize) || plainSize < 0) throw new Error("bad plain size");
  const raw = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(raw, 0);
  raw.writeUInt8(FORMAT_VERSION, 8);
  raw.writeUInt32BE(chunkSize, 9);
  raw.writeBigUInt64BE(BigInt(plainSize), 13);
  noncePrefix.copy(raw, 21, 0, 8);
  // bytes 29..31 reserved (zero)
  return { version: FORMAT_VERSION, chunkSize, plainSize, noncePrefix: Buffer.from(noncePrefix.subarray(0, 8)), raw };
}

export function parseHeader(raw: Buffer): VaultHeader {
  if (raw.length < HEADER_LEN || !raw.subarray(0, 8).equals(MAGIC)) throw new Error("not a VONO vault file");
  const version = raw.readUInt8(8);
  if (version !== FORMAT_VERSION) throw new Error(`unsupported vault format ${version}`);
  const chunkSize = raw.readUInt32BE(9);
  const plainSize = Number(raw.readBigUInt64BE(13));
  if (chunkSize < 1024 || chunkSize > 16 * 1024 * 1024 || !Number.isSafeInteger(plainSize)) throw new Error("corrupt vault header");
  return { version, chunkSize, plainSize, noncePrefix: Buffer.from(raw.subarray(21, 29)), raw: Buffer.from(raw.subarray(0, HEADER_LEN)) };
}

export function chunkCount(h: Pick<VaultHeader, "plainSize" | "chunkSize">): number {
  return h.plainSize === 0 ? 1 : Math.ceil(h.plainSize / h.chunkSize);
}

/** Plain length of chunk i. */
export function chunkPlainLen(h: Pick<VaultHeader, "plainSize" | "chunkSize">, i: number): number {
  const n = chunkCount(h);
  if (i < 0 || i >= n) throw new Error("chunk out of range");
  return i < n - 1 ? h.chunkSize : h.plainSize - (n - 1) * h.chunkSize;
}

/** Byte offset of chunk i in the file. */
export function chunkFileOffset(h: Pick<VaultHeader, "chunkSize">, i: number): number {
  return HEADER_LEN + i * (h.chunkSize + TAG_LEN);
}

/** Total encrypted file size for a header. */
export function encryptedFileSize(h: Pick<VaultHeader, "plainSize" | "chunkSize">): number {
  const n = chunkCount(h);
  return HEADER_LEN + h.plainSize + n * TAG_LEN;
}

function nonce(h: VaultHeader, i: number): Buffer {
  const n = Buffer.alloc(12);
  h.noncePrefix.copy(n, 0, 0, 8);
  n.writeUInt32BE(i, 8);
  return n;
}

function aad(h: VaultHeader, i: number): Buffer {
  const a = Buffer.alloc(HEADER_LEN + 5);
  h.raw.copy(a, 0);
  a.writeUInt32BE(i, HEADER_LEN);
  a.writeUInt8(i === chunkCount(h) - 1 ? 1 : 0, HEADER_LEN + 4);
  return a;
}

/** Encrypt chunk i (plaintext length must equal chunkPlainLen). Returns ciphertext ‖ tag. */
export function encryptChunk(key: Buffer, h: VaultHeader, i: number, plain: Buffer): Buffer {
  if (plain.length !== chunkPlainLen(h, i)) throw new Error("chunk length mismatch");
  const c = createCipheriv("aes-256-gcm", key, nonce(h, i));
  c.setAAD(aad(h, i));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([body, c.getAuthTag()]);
}

/** Decrypt chunk i (ciphertext ‖ tag). Throws if the data was altered, moved or belongs to another file. */
export function decryptChunk(key: Buffer, h: VaultHeader, i: number, sealed: Buffer): Buffer {
  const len = chunkPlainLen(h, i);
  if (sealed.length !== len + TAG_LEN) throw new Error("sealed chunk length mismatch");
  const d = createDecipheriv("aes-256-gcm", key, nonce(h, i));
  d.setAAD(aad(h, i));
  d.setAuthTag(sealed.subarray(len));
  return Buffer.concat([d.update(sealed.subarray(0, len)), d.final()]);
}
