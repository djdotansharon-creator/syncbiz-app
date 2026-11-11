/**
 * OFFLINE SERVICE (Music Bank Phase 2, stage C; owner-approved 2026-11-11 "מאשר שלב ג").
 *
 * Ties the encrypted vault (vault-*.ts) to the station:
 *  - RESOLVER (`resolve`): SYNC, in-memory only, never throws — MpvManager.loadInternal calls it right before the media
 *    token is appended. Our own `/api/media/<logicalId>` URL whose song is stored + licensed → the loopback URL;
 *    anything else (YouTube, local files, jingles, not stored, license ended, vault off) → the URL UNCHANGED (stream, as
 *    before). The orchestrator keeps the original URL for its own decisions; only the loadfile target changes.
 *  - SYNC (`sync`): fetch the offline manifest with the station's Bearer (stage B), keep its license (encrypted with the
 *    vault key), quietly download the missing songs one at a time through the normal token-scoped /api/media route at a
 *    capped rate (never competes hard with the live stream), verify each against its sha256, and remove songs the
 *    business is no longer entitled to (never one that is loaded right now — retried next sync).
 *  - OFF by default: only a machine whose `ProgramData\VONO\state\offline.json` says {"enabled":true} runs any of this.
 *  - No internet: the last license keeps the stored songs playable until it ends (rolling 7 days, stage B); stored
 *    copies whose license ended over 30 days ago are deleted (owner: lock → delete after 30 days).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { OfflineVault } from "./vault-store";
import type { VaultServer } from "./vault-server";

export type ManifestTrack = { logicalId: string; title: string; contentHash: string; sizeBytes: number; mimeType: string };
export type ManifestBank = { bankId: string; name: string; endsAt: string | null; validUntil: string; tracks: ManifestTrack[] };
export type Manifest = { version: number; issuedAt: string; banks: ManifestBank[] };

/** What the station may play offline: logicalId → license end (ms). Persisted encrypted. */
type License = { savedAt: number; until: Record<string, number> };

export type OfflineServiceDeps = {
  dir: string;
  master: Buffer;
  vault: OfflineVault;
  server: VaultServer;
  getConfig: () => { apiBaseUrl?: string | null; wsToken?: string | null };
  /** Adds the station media token to our /api/media URL (media-token-provider withStationMediaToken). */
  withToken: (url: string) => string;
  fetchFn?: typeof fetch;
  now?: () => number;
  log?: (level: "INFO" | "WARN", msg: string, data?: Record<string, unknown>) => void;
  /** Download rate cap, bytes / second (default 1.5 MB/s). */
  rateBytesPerSec?: number;
  sleep?: (ms: number) => Promise<void>;
};

const DELETE_AFTER_LICENSE_END_MS = 30 * 24 * 60 * 60 * 1000;
const IN_USE_MS = 15 * 60 * 1000; // a song served in the last 15 min is never deleted (a deck may hold it)
const MANIFEST_TIMEOUT_MS = 15_000;
const LICENSE_FILE = "license.bin";

function apiOrigin(apiBaseUrl: string | null | undefined): string | null {
  try {
    const u = new URL(String(apiBaseUrl ?? "").trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** logicalId of our own `/api/media/<id>` URL (same origin as the API), else null. */
export function ownMediaLogicalId(url: string, apiBaseUrl: string | null | undefined): string | null {
  const origin = apiOrigin(apiBaseUrl);
  if (!origin) return null;
  try {
    const u = new URL(url);
    if (u.origin !== origin) return null;
    const m = /^\/api\/media\/([^/]+)$/.exec(u.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function licenseKey(master: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.from("vono-offline-v1"), Buffer.from("license"), 32));
}

export function sealLicense(master: Buffer, lic: License): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", licenseKey(master), iv);
  const body = Buffer.concat([c.update(JSON.stringify(lic), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function openLicense(master: Buffer, sealed: Buffer): License | null {
  try {
    const d = createDecipheriv("aes-256-gcm", licenseKey(master), sealed.subarray(0, 12));
    d.setAuthTag(sealed.subarray(12, 28));
    const j = JSON.parse(Buffer.concat([d.update(sealed.subarray(28)), d.final()]).toString("utf8")) as License;
    return j && typeof j.until === "object" ? j : null;
  } catch {
    return null; // edited / foreign → no license (stream)
  }
}

/** Cap an async byte stream at `rate` bytes/second (quiet background download). */
async function* throttle(src: AsyncIterable<Uint8Array>, rate: number, now: () => number, sleep: (ms: number) => Promise<void>): AsyncGenerator<Buffer> {
  const t0 = now();
  let sent = 0;
  for await (const piece of src) {
    const b = Buffer.from(piece);
    sent += b.length;
    const due = (sent / rate) * 1000 - (now() - t0);
    if (due > 5) await sleep(due);
    yield b;
  }
}

export class OfflineService {
  private license: License = { savedAt: 0, until: {} };
  private readonly servedAt = new Map<string, number>();
  private readonly corrupt = new Set<string>();
  private syncing: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: OfflineServiceDeps) {
    this.now = d.now ?? Date.now;
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    try {
      this.license = openLicense(d.master, readFileSync(path.join(d.dir, LICENSE_FILE))) ?? this.license;
    } catch {
      /* no license yet */
    }
  }

  /** HOT PATH (MpvManager.loadInternal): sync, in-memory, never throws. Unchanged URL unless stored + licensed. */
  resolve(url: string): string {
    try {
      const id = ownMediaLogicalId(url, this.d.getConfig().apiBaseUrl);
      if (!id || this.corrupt.has(id)) return url;
      const until = this.license.until[id];
      if (!until || until <= this.now()) return url; // license ended → stream (the server decides)
      const local = this.d.server.urlFor(id);
      if (!local) return url;
      this.servedAt.set(id, this.now());
      return local;
    } catch {
      return url;
    }
  }

  /** The loopback server reported a broken file → never serve it again; the next sync re-downloads it. */
  markCorrupt(opaqueId: string): void {
    for (const id of this.d.vault.logicalIds()) if (this.d.vault.lookup(id)?.opaqueId === opaqueId) this.corrupt.add(id);
    this.d.log?.("WARN", "OFFLINE_CORRUPT", { opaqueId: opaqueId.slice(0, 8) });
  }

  /** Stored songs that are licensed right now (diagnostic). */
  readyCount(): number {
    const t = this.now();
    return this.d.vault.logicalIds().filter((id) => (this.license.until[id] ?? 0) > t && !this.corrupt.has(id)).length;
  }

  private saveLicense(): void {
    const file = path.join(this.d.dir, LICENSE_FILE);
    writeFileSync(`${file}.tmp`, sealLicense(this.d.master, this.license));
    renameSync(`${file}.tmp`, file);
  }

  private inUse(id: string): boolean {
    const t = this.servedAt.get(id);
    return t != null && this.now() - t < IN_USE_MS;
  }

  /** One background sync (de-duplicated). Never throws. */
  sync(reason: string): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.runSync(reason).catch((e) => this.d.log?.("WARN", "OFFLINE_SYNC_FAILED", { reason, err: (e as Error)?.message?.slice(0, 120) })).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async runSync(reason: string): Promise<void> {
    const cfg = this.d.getConfig();
    const origin = apiOrigin(cfg.apiBaseUrl);
    const bearer = String(cfg.wsToken ?? "").trim();
    const f = this.d.fetchFn ?? fetch;
    let manifest: Manifest | null = null;
    if (origin && bearer) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), MANIFEST_TIMEOUT_MS);
      try {
        const res = await f(`${origin}/api/music-bank/offline-manifest`, { headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" }, signal: ctrl.signal });
        if (res.ok) manifest = (await res.json()) as Manifest;
        else this.d.log?.("WARN", "OFFLINE_MANIFEST_REFUSED", { reason, httpStatus: res.status });
      } catch {
        this.d.log?.("INFO", "OFFLINE_MANIFEST_UNREACHABLE", { reason }); // offline: keep the last license
      } finally {
        clearTimeout(t);
      }
    }

    const nowMs = this.now();
    if (manifest && Array.isArray(manifest.banks)) {
      // the manifest is authoritative while online: the license = exactly what it lists
      const until: Record<string, number> = {};
      const wanted = new Map<string, ManifestTrack>();
      for (const b of manifest.banks) {
        const end = Date.parse(b.validUntil);
        if (!Number.isFinite(end)) continue;
        for (const tr of b.tracks ?? []) {
          until[tr.logicalId] = Math.max(until[tr.logicalId] ?? 0, end);
          wanted.set(tr.logicalId, tr);
        }
      }
      this.license = { savedAt: nowMs, until };
      this.saveLicense();
      // remove what is no longer entitled (never a song a deck may be holding)
      let removed = 0;
      for (const id of this.d.vault.logicalIds()) {
        if (!wanted.has(id) && !this.inUse(id)) {
          this.d.vault.remove(id);
          removed++;
        }
      }
      // re-download corrupt ones, then the missing ones — one at a time, rate-capped
      for (const id of [...this.corrupt]) {
        if (this.inUse(id)) continue;
        this.d.vault.remove(id);
        this.corrupt.delete(id);
      }
      let added = 0;
      let failed = 0;
      for (const tr of wanted.values()) {
        if (this.corrupt.has(tr.logicalId)) continue; // still held by a deck → replaced at a later sync (it streams meanwhile)
        if (this.d.vault.lookup(tr.logicalId)) continue;
        try {
          await this.download(origin!, tr);
          added++;
        } catch (e) {
          failed++;
          this.d.log?.("WARN", "OFFLINE_DOWNLOAD_FAILED", { logicalId: tr.logicalId, err: (e as Error)?.message?.slice(0, 120) });
        }
      }
      this.d.log?.("INFO", "OFFLINE_SYNC_DONE", { reason, entitled: wanted.size, stored: this.d.vault.logicalIds().length, added, removed, failed, diskMB: Math.round(this.d.vault.diskBytes() / 1048576) });
      return;
    }
    // no manifest (offline / refused): keep the license; delete only copies whose license ended over 30 days ago
    for (const id of this.d.vault.logicalIds()) {
      const until = this.license.until[id] ?? 0;
      if (until + DELETE_AFTER_LICENSE_END_MS < nowMs && !this.inUse(id)) this.d.vault.remove(id);
    }
  }

  private async download(origin: string, tr: ManifestTrack): Promise<void> {
    const url = this.d.withToken(`${origin}/api/media/${encodeURIComponent(tr.logicalId)}`);
    if (!/[?&]mt=/.test(url)) throw new Error("no media token yet");
    const f = this.d.fetchFn ?? fetch;
    const res = await f(url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const body = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
    await this.d.vault.store(throttle(body, this.d.rateBytesPerSec ?? 1.5 * 1024 * 1024, this.now, this.sleep), {
      logicalId: tr.logicalId,
      contentHash: tr.contentHash,
      sizeBytes: tr.sizeBytes,
      mimeType: tr.mimeType,
    });
  }
}
