/**
 * OFFLINE VAULT — on-disk store (Music Bank Phase 2, stage A; owner 2026-11-10/11). PURE Node (no Electron).
 *
 * Layout under `dir` (VONO MAIN: `C:\ProgramData\VONO\offline`):
 *   vault.key              the DPAPI-protected machine master key (vault-keys.ts)
 *   index.json             logicalId → { opaqueId, contentHash, sizeBytes, mimeType, storedAt } (song ids are not secret —
 *                          owner: "names may be visible"; the CONTENT is what is protected)
 *   objects/<opaque>.vono  the encrypted song (vault-crypto.ts format)
 *
 * Rules: a song is written to `<opaque>.vono.part`, its plaintext SHA-256 + size are verified against the server's
 * MediaAsset.contentHash / sizeBytes, and only then renamed into place and added to the index (atomic tmp+rename) — a
 * half-downloaded or wrong song is never "offline ready". Memory stays bounded (one 1 MiB chunk at a time).
 * The index is held in memory so `lookup()` is synchronous and cheap (the future MPV resolver runs on the hot path).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CHUNK,
  HEADER_LEN,
  TAG_LEN,
  assetKey,
  buildHeader,
  chunkCount,
  chunkFileOffset,
  chunkPlainLen,
  decryptChunk,
  encryptChunk,
  encryptedFileSize,
  opaqueIdFor,
  parseHeader,
} from "./vault-crypto";

export type VaultEntry = { opaqueId: string; contentHash: string; sizeBytes: number; mimeType: string; storedAt: string };
type IndexFile = { version: 1; assets: Record<string, VaultEntry> };

export class OfflineVault {
  private readonly objectsDir: string;
  private readonly indexPath: string;
  private index: Record<string, VaultEntry> = {};

  constructor(private readonly dir: string, private readonly master: Buffer, private readonly chunkSize = DEFAULT_CHUNK) {
    if (master.length !== 32) throw new Error("vault master key must be 32 bytes");
    this.objectsDir = path.join(dir, "objects");
    this.indexPath = path.join(dir, "index.json");
    mkdirSync(this.objectsDir, { recursive: true });
    this.index = this.readIndex();
  }

  private readIndex(): Record<string, VaultEntry> {
    try {
      const j = JSON.parse(readFileSync(this.indexPath, "utf8")) as IndexFile;
      return j && j.version === 1 && j.assets && typeof j.assets === "object" ? j.assets : {};
    } catch {
      return {};
    }
  }

  private writeIndex(): void {
    const tmp = `${this.indexPath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, assets: this.index } satisfies IndexFile));
    renameSync(tmp, this.indexPath);
  }

  objectPath(opaqueId: string): string {
    return path.join(this.objectsDir, `${opaqueId}.vono`);
  }

  /** SYNC, no disk I/O: the stored entry for a song, or null. */
  lookup(logicalId: string): VaultEntry | null {
    return Object.prototype.hasOwnProperty.call(this.index, logicalId) ? this.index[logicalId] : null;
  }

  /** SYNC, no disk I/O: opaque id → entry (the loopback server resolves requests by opaque id). */
  byOpaqueId(opaqueId: string): VaultEntry | null {
    for (const e of Object.values(this.index)) if (e.opaqueId === opaqueId) return e;
    return null;
  }

  /** Every stored song id. */
  logicalIds(): string[] {
    return Object.keys(this.index);
  }

  /** Bytes used on disk by stored songs (encrypted size). */
  diskBytes(): number {
    let n = 0;
    for (const e of Object.values(this.index)) n += encryptedFileSize({ plainSize: e.sizeBytes, chunkSize: this.chunkSize });
    return n;
  }

  /** The file is present with exactly the expected size (cheap integrity probe; the full check is GCM on read). */
  isIntact(logicalId: string): boolean {
    const e = this.lookup(logicalId);
    if (!e) return false;
    try {
      return statSync(this.objectPath(e.opaqueId)).size === encryptedFileSize({ plainSize: e.sizeBytes, chunkSize: this.chunkSize });
    } catch {
      return false;
    }
  }

  /**
   * Store one song from a plaintext byte stream (e.g. the /api/media download). Verifies size + SHA-256 before it becomes
   * visible. Re-storing an existing song is a no-op. Throws on mismatch (nothing is left behind).
   */
  async store(
    input: AsyncIterable<Buffer | Uint8Array>,
    meta: { logicalId: string; contentHash: string; sizeBytes: number; mimeType?: string },
  ): Promise<VaultEntry> {
    const existing = this.lookup(meta.logicalId);
    if (existing && existing.contentHash === meta.contentHash.toLowerCase() && this.isIntact(meta.logicalId)) return existing;

    const contentHash = meta.contentHash.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error("contentHash must be a sha256 hex");
    const opaqueId = opaqueIdFor(this.master, contentHash);
    const key = assetKey(this.master, opaqueId);
    const header = buildHeader(meta.sizeBytes, this.chunkSize);
    const final = this.objectPath(opaqueId);
    const part = `${final}.part`;
    const sha = createHash("sha256");
    let fh: FileHandle | null = null;
    let index = 0;
    let received = 0;
    let pending: Buffer[] = [];
    let pendingLen = 0;
    try {
      fh = await open(part, "w");
      await fh.write(header.raw, 0, HEADER_LEN, 0);
      let pos = HEADER_LEN;
      const flush = async (len: number) => {
        const all = Buffer.concat(pending, pendingLen);
        const plain = all.subarray(0, len);
        const rest = all.subarray(len);
        const sealed = encryptChunk(key, header, index, plain);
        await fh!.write(sealed, 0, sealed.length, pos);
        pos += sealed.length;
        index++;
        pending = rest.length ? [Buffer.from(rest)] : [];
        pendingLen = rest.length;
      };
      for await (const piece of input) {
        const b = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
        received += b.length;
        if (received > meta.sizeBytes) throw new Error("download is larger than expected");
        sha.update(b);
        pending.push(b);
        pendingLen += b.length;
        while (pendingLen >= this.chunkSize && index < chunkCount(header) - 1) await flush(this.chunkSize);
      }
      if (received !== meta.sizeBytes) throw new Error(`download size ${received} ≠ expected ${meta.sizeBytes}`);
      await flush(chunkPlainLen(header, index)); // the last chunk (also the single empty chunk of a 0-byte file)
      if (sha.digest("hex") !== contentHash) throw new Error("download does not match its content hash");
      await fh.sync();
      await fh.close();
      fh = null;
      renameSync(part, final);
    } catch (e) {
      try {
        await fh?.close();
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(part);
      } catch {
        /* ignore */
      }
      throw e;
    }
    const entry: VaultEntry = { opaqueId, contentHash, sizeBytes: meta.sizeBytes, mimeType: meta.mimeType || "audio/mpeg", storedAt: new Date().toISOString() };
    this.index[meta.logicalId] = entry;
    this.writeIndex();
    return entry;
  }

  /**
   * Decrypt plaintext bytes [start, endInclusive] of a stored song, one chunk at a time (bounded memory). Every chunk is
   * GCM-verified — an altered / truncated / swapped file throws, it never yields wrong audio.
   */
  async *readRange(opaqueId: string, start: number, endInclusive: number): AsyncGenerator<Buffer> {
    const fh = await open(this.objectPath(opaqueId), "r");
    try {
      const raw = Buffer.alloc(HEADER_LEN);
      await fh.read(raw, 0, HEADER_LEN, 0);
      const h = parseHeader(raw); // the file's own header is authoritative (validated: magic, version, chunk size)
      const end = Math.min(endInclusive, h.plainSize - 1);
      if (h.plainSize === 0 || start > end) return;
      const key = assetKey(this.master, opaqueId);
      const first = Math.floor(start / h.chunkSize);
      const last = Math.floor(end / h.chunkSize);
      for (let i = first; i <= last; i++) {
        const len = chunkPlainLen(h, i) + TAG_LEN;
        const sealed = Buffer.alloc(len);
        const { bytesRead } = await fh.read(sealed, 0, len, chunkFileOffset(h, i));
        if (bytesRead !== len) throw new Error("vault file is truncated");
        const plain = decryptChunk(key, h, i, sealed);
        const from = i === first ? start - i * h.chunkSize : 0;
        const to = i === last ? end - i * h.chunkSize + 1 : plain.length;
        yield plain.subarray(from, to);
      }
    } finally {
      await fh.close();
    }
  }

  /** Remove one song (file + index). Missing is fine. */
  remove(logicalId: string): void {
    const e = this.lookup(logicalId);
    if (!e) return;
    delete this.index[logicalId];
    this.writeIndex();
    // another logicalId may share the same content (same opaque id) — keep the file then
    if (!Object.values(this.index).some((x) => x.opaqueId === e.opaqueId)) {
      try {
        unlinkSync(this.objectPath(e.opaqueId));
      } catch {
        /* already gone */
      }
    }
  }

  /** Remove everything (Offline switched off for the whole machine / key lost). */
  removeAll(): void {
    for (const id of this.logicalIds()) this.remove(id);
  }

  /** Test / diagnostic: does an object file exist for this opaque id? */
  hasObjectFile(opaqueId: string): boolean {
    return existsSync(this.objectPath(opaqueId));
  }
}
