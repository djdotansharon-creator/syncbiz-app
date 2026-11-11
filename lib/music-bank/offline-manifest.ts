/**
 * OFFLINE MANIFEST (Music Bank Phase 2, stage B; owner 2026-11-10/11). Server-only.
 *
 * What a station may keep OFFLINE (encrypted, desktop/src/main/offline/*) and until when. Owner rules:
 *  - Offline only for a bank the business switched OFFLINE on in the catalog (stage D, MusicBankGrant.offlineEnabled) AND is
 *    entitled to. Today that is a PRIVATE bank opened to it (All Day Mix);
 *    public Royalty-Free genre packs are not offline-entitled until billing exists (paid packs → later).
 *  - A bank that was switched off stops at its close (the next 04:00, lib/music-bank/day-boundary.ts) — offline copies
 *    follow the same end, so seen == heard == offline.
 *  - The LICENSE is rolling: valid for OFFLINE_LICENSE_DAYS from each successful refresh (a branch with no internet keeps
 *    playing that long — the owner's 7-day grace), and never past the bank's own end.
 * The manifest carries ids, titles, sizes and content hashes only — the songs themselves are downloaded through the
 * normal token-scoped /api/media route and verified against contentHash before they are stored.
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { PRIVATE_BANKS } from "./private-banks";
import { grantEndsAt } from "./day-boundary";

export const OFFLINE_LICENSE_DAYS = 7;
export const MANIFEST_VERSION = 1;

export type OfflineTrack = { logicalId: string; title: string; contentHash: string; sizeBytes: number; mimeType: string; durationSeconds: number | null };
export type OfflineBank = { bankId: string; name: string; endsAt: string | null; validUntil: string; tracks: OfflineTrack[]; totalBytes: number };
export type OfflineManifest = { version: number; issuedAt: string; workspaceId: string; banks: OfflineBank[]; totalBytes: number };

/** offlineEnabled: the business switched OFFLINE on for this bank in the catalog (stage D). Missing / false → streams only. */
type GrantRow = { bankId: string; expiresAt: Date | null; closesAt: Date | null; offlineEnabled?: boolean };
type AssetRow = { logicalId: string | null; contentHash: string; contentHashAlgorithm: string; sizeBytes: bigint | number; mimeType: string; durationSeconds: number | null };

/** PURE: compose the manifest from grant rows + READY assets (testable without a database). */
export function composeOfflineManifest(input: { now: Date; workspaceId: string; grants: GrantRow[]; assets: AssetRow[] }): OfflineManifest {
  const now = input.now.getTime();
  const byLogical = new Map<string, AssetRow>();
  for (const a of input.assets) if (a.logicalId && a.contentHashAlgorithm === "sha256" && /^[0-9a-f]{64}$/i.test(a.contentHash)) byLogical.set(a.logicalId, a);
  const licenseCap = now + OFFLINE_LICENSE_DAYS * 24 * 60 * 60 * 1000;
  const banks: OfflineBank[] = [];
  for (const g of input.grants) {
    if (g.offlineEnabled !== true) continue; // stage D: Offline is switched on per bank by the business — off = stream only
    const bank = PRIVATE_BANKS.find((b) => b.id === g.bankId);
    if (!bank) continue;
    const end = grantEndsAt({ closesAt: g.closesAt, expiresAt: g.expiresAt });
    if (end && end.getTime() <= now) continue; // closed → not offline any more (the station removes its copies)
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

/** The business's offline manifest. Never throws (a failed lookup = nothing offline-entitled — the station keeps what it has until its license runs out). */
export async function offlineManifestForWorkspace(workspaceId: string): Promise<OfflineManifest | null> {
  try {
    const grants = await prisma.musicBankGrant.findMany({ where: { workspaceId }, select: { bankId: true, expiresAt: true, closesAt: true, offlineEnabled: true } });
    const ids = new Set<string>();
    for (const g of grants) for (const t of PRIVATE_BANKS.find((b) => b.id === g.bankId)?.tracks ?? []) ids.add(t.id);
    const assets = ids.size
      ? await prisma.mediaAsset.findMany({
          where: { status: "READY", logicalId: { in: [...ids] } },
          select: { logicalId: true, contentHash: true, contentHashAlgorithm: true, sizeBytes: true, mimeType: true, durationSeconds: true },
        })
      : [];
    return composeOfflineManifest({ now: new Date(), workspaceId, grants, assets });
  } catch (e) {
    console.warn("[music-bank/offline-manifest] lookup failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}


/**
 * The catalog's Offline switch per private bank of a business (stage D): on/off + how much disk the bank needs (the sum of
 * its READY songs). Never throws (failure → empty: the switch is simply not shown).
 */
export async function offlineInfoForWorkspace(workspaceId: string | null | undefined): Promise<Record<string, { enabled: boolean; bytes: number }>> {
  if (!workspaceId) return {};
  try {
    const grants = await prisma.musicBankGrant.findMany({ where: { workspaceId }, select: { bankId: true, offlineEnabled: true } });
    const out: Record<string, { enabled: boolean; bytes: number }> = {};
    for (const g of grants) {
      const bank = PRIVATE_BANKS.find((b) => b.id === g.bankId);
      if (!bank) continue;
      const rows = await prisma.mediaAsset.findMany({ where: { status: "READY", logicalId: { in: bank.tracks.map((t) => t.id) } }, select: { sizeBytes: true } });
      out[bank.id] = { enabled: g.offlineEnabled === true, bytes: rows.reduce((s, r) => s + Number(r.sizeBytes), 0) };
    }
    return out;
  } catch (e) {
    console.warn("[music-bank/offline-info] lookup failed:", e instanceof Error ? e.message : String(e));
    return {};
  }
}
