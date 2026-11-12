/**
 * OFFLINE MANIFEST (Music Bank Phase 2; owner 2026-11-10/11/12). Server-only.
 *
 * What ONE COMPUTER (station) may keep OFFLINE (encrypted, desktop/src/main/offline/*) and until when. Owner rules:
 *  - 2026-11-12: Offline is chosen PER COMPUTER and PER BANK ("only the bank I click downloads; each computer on its own")
 *    — StationOfflineBank rows, switched in the catalog of the VONO app on that computer. Nothing downloads by itself.
 *  - The bank must also be ENTITLED right now:
 *      · a PRIVATE bank (lib/music-bank/private-banks.ts) with a live grant for the business, or
 *      · a Royalty-Free DEMO pack (the POC catalog genres) — open to every business to try Offline until billing exists
 *        (owner 2026-11-12: "what is in the player is only a demo"; later, a paid bank becomes the offline one).
 *  - A bank that was switched off stops at its close (the next 04:00, lib/music-bank/day-boundary.ts) — offline copies
 *    follow the same end, so seen == heard == offline.
 *  - The LICENSE is rolling: valid for OFFLINE_LICENSE_DAYS from each successful refresh (a branch with no internet keeps
 *    playing that long — the owner's 7-day grace), and never past the bank's own end.
 * The manifest carries ids, titles, sizes and content hashes only — the songs themselves are downloaded through the
 * normal token-scoped /api/media route and verified against contentHash before they are stored.
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { PRIVATE_BANKS, privateGenreIds } from "./private-banks";
import { POC_MUSIC_BANK_CATALOG } from "./poc-catalog";
import { grantEndsAt } from "./day-boundary";
import type { MusicBankSampleTrack } from "./catalog-types";

export const OFFLINE_LICENSE_DAYS = 7;
export const MANIFEST_VERSION = 1;

export type OfflineTrack = { logicalId: string; title: string; contentHash: string; sizeBytes: number; mimeType: string; durationSeconds: number | null };
export type OfflineBank = { bankId: string; name: string; endsAt: string | null; validUntil: string; tracks: OfflineTrack[]; totalBytes: number };
export type OfflineManifest = { version: number; issuedAt: string; workspaceId: string; banks: OfflineBank[]; totalBytes: number };

type GrantRow = { bankId: string; expiresAt: Date | null; closesAt: Date | null };
type AssetRow = { logicalId: string | null; contentHash: string; contentHashAlgorithm: string; sizeBytes: bigint | number; mimeType: string; durationSeconds: number | null };
type BankDef = { id: string; name: string; tracks: MusicBankSampleTrack[] };

/** The Royalty-Free DEMO packs every business may keep offline (the POC catalog genres that are not a private bank's). */
export function demoPacks(): BankDef[] {
  const priv = privateGenreIds();
  return POC_MUSIC_BANK_CATALOG.genres.filter((g) => !priv.has(g.id)).map((g) => ({ id: g.id, name: g.name, tracks: g.tracks }));
}

/** Every bank that can be kept offline, by id (private banks + demo packs). */
function offlineCapableBank(id: string): BankDef | null {
  return PRIVATE_BANKS.find((b) => b.id === id) ?? demoPacks().find((p) => p.id === id) ?? null;
}

/**
 * The banks this business is ENTITLED to keep offline right now, with their end (null = no end). Private: live grant
 * (its end = the grant's end). Demo packs: always, no end.
 */
export function entitledOfflineBanks(now: Date, grants: GrantRow[]): Map<string, Date | null> {
  const out = new Map<string, Date | null>();
  for (const g of grants) {
    if (!PRIVATE_BANKS.some((b) => b.id === g.bankId)) continue;
    const end = grantEndsAt({ closesAt: g.closesAt, expiresAt: g.expiresAt });
    if (end && end.getTime() <= now.getTime()) continue; // closed → not offline any more (the station removes its copies)
    out.set(g.bankId, end);
  }
  for (const p of demoPacks()) out.set(p.id, null);
  return out;
}

/**
 * PURE: compose ONE COMPUTER's manifest from the banks switched Offline on that computer (`chosen`), the business's grant
 * rows and READY assets (testable without a database). A chosen bank that is not entitled is left out (→ the station
 * deletes its copies); an entitled bank that was not chosen is left out (→ it streams).
 */
export function composeOfflineManifest(input: { now: Date; workspaceId: string; chosen: Iterable<string>; grants: GrantRow[]; assets: AssetRow[] }): OfflineManifest {
  const now = input.now.getTime();
  const byLogical = new Map<string, AssetRow>();
  for (const a of input.assets) if (a.logicalId && a.contentHashAlgorithm === "sha256" && /^[0-9a-f]{64}$/i.test(a.contentHash)) byLogical.set(a.logicalId, a);
  const licenseCap = now + OFFLINE_LICENSE_DAYS * 24 * 60 * 60 * 1000;
  const entitled = entitledOfflineBanks(input.now, input.grants);
  const banks: OfflineBank[] = [];
  for (const bankId of new Set(input.chosen)) {
    if (!entitled.has(bankId)) continue;
    const bank = offlineCapableBank(bankId);
    if (!bank) continue;
    const end = entitled.get(bankId) ?? null;
    const tracks: OfflineTrack[] = [];
    for (const t of bank.tracks) {
      const a = byLogical.get(t.id);
      if (!a) continue; // not READY on this server → it simply streams (or is skipped) — never a broken offline entry
      tracks.push({
        logicalId: t.id,
        title: t.title,
        contentHash: a.contentHash.toLowerCase(),
        sizeBytes: Number(a.sizeBytes),
        mimeType: a.mimeType || "audio/mpeg",
        durationSeconds: a.durationSeconds ?? null,
      });
    }
    const validUntil = Math.min(licenseCap, end ? end.getTime() : Infinity);
    banks.push({
      bankId: bank.id,
      name: bank.name,
      endsAt: end ? end.toISOString() : null,
      validUntil: new Date(validUntil).toISOString(),
      tracks,
      totalBytes: tracks.reduce((s, t) => s + t.sizeBytes, 0),
    });
  }
  return { version: MANIFEST_VERSION, issuedAt: input.now.toISOString(), workspaceId: input.workspaceId, banks, totalBytes: banks.reduce((s, b) => s + b.totalBytes, 0) };
}

async function readyAssetsFor(bankIds: Iterable<string>): Promise<AssetRow[]> {
  const ids = new Set<string>();
  for (const id of bankIds) for (const t of offlineCapableBank(id)?.tracks ?? []) ids.add(t.id);
  if (!ids.size) return [];
  return prisma.mediaAsset.findMany({
    where: { status: "READY", logicalId: { in: [...ids] } },
    select: { logicalId: true, contentHash: true, contentHashAlgorithm: true, sizeBytes: true, mimeType: true, durationSeconds: true },
  });
}

/**
 * ONE COMPUTER's offline manifest. Never throws (a failed lookup = null → 503: the station keeps what it has until its
 * license runs out).
 */
export async function offlineManifestForStation(workspaceId: string, durableDeviceId: string): Promise<OfflineManifest | null> {
  try {
    const [rows, grants] = await Promise.all([
      prisma.stationOfflineBank.findMany({ where: { workspaceId, durableDeviceId }, select: { bankId: true } }),
      prisma.musicBankGrant.findMany({ where: { workspaceId }, select: { bankId: true, expiresAt: true, closesAt: true } }),
    ]);
    const chosen = rows.map((r) => r.bankId);
    const assets = await readyAssetsFor(chosen);
    return composeOfflineManifest({ now: new Date(), workspaceId, chosen, grants, assets });
  } catch (e) {
    console.warn("[music-bank/offline-manifest] lookup failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export type OfflineBankInfo = { enabled: boolean; bytes: number };

/**
 * The catalog's Offline switch for ONE COMPUTER: for every bank this business may keep offline right now — on/off on that
 * computer + how much disk it needs (the sum of its READY songs). `durableDeviceId` null (a browser) → all off. Never
 * throws (failure → empty: the switches are simply not shown).
 */
export async function offlineInfoForStation(workspaceId: string | null | undefined, durableDeviceId: string | null): Promise<Record<string, OfflineBankInfo>> {
  if (!workspaceId) return {};
  try {
    const [grants, rows] = await Promise.all([
      prisma.musicBankGrant.findMany({ where: { workspaceId }, select: { bankId: true, expiresAt: true, closesAt: true } }),
      durableDeviceId ? prisma.stationOfflineBank.findMany({ where: { workspaceId, durableDeviceId }, select: { bankId: true } }) : Promise.resolve([]),
    ]);
    const entitled = [...entitledOfflineBanks(new Date(), grants).keys()];
    const on = new Set(rows.map((r) => r.bankId));
    const assets = await readyAssetsFor(entitled);
    const size = new Map<string, number>();
    for (const a of assets) if (a.logicalId) size.set(a.logicalId, Number(a.sizeBytes));
    const out: Record<string, OfflineBankInfo> = {};
    for (const id of entitled) {
      const bank = offlineCapableBank(id);
      if (!bank) continue;
      out[id] = { enabled: on.has(id), bytes: bank.tracks.reduce((s, t) => s + (size.get(t.id) ?? 0), 0) };
    }
    return out;
  } catch (e) {
    console.warn("[music-bank/offline-info] lookup failed:", e instanceof Error ? e.message : String(e));
    return {};
  }
}

/** May this bank be switched Offline by this business right now (entitled)? */
export async function isOfflineEntitled(workspaceId: string, bankId: string): Promise<boolean> {
  const grants = await prisma.musicBankGrant.findMany({ where: { workspaceId }, select: { bankId: true, expiresAt: true, closesAt: true } });
  return entitledOfflineBanks(new Date(), grants).has(bankId);
}
