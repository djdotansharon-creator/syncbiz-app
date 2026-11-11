/**
 * Who may use which PRIVATE music bank (owner 2026-11-10). Server-only.
 *
 * - A business (workspace) may use a private bank while it holds a LIVE MusicBankGrant (no expiry, or expiry ahead).
 * - 2026-11-11 (owner rule: "only when I switch it on should it be SEEN and HEARD"): there is NO see-everything bypass,
 *   not even for the platform owner — the catalog (signed-in person → their active business) and the media token
 *   (station → its business; person → their active business) use the SAME grant check, so seen == heard everywhere.
 *   The admin screen (Platform → Accounts) still lists every bank so the owner can open / close them.
 * - 2026-11-11 (owner rule: "never cut the music in the middle of the day"): a close sets `closesAt` = the next 04:00 in
 *   branch time (lib/music-bank/day-boundary.ts). The CATALOG stops listing the bank at that moment; the MEDIA TOKEN keeps
 *   it for CLOSE_GRACE_MS more, so the station finishes its song and its renderer guard (components/private-bank-guard.tsx)
 *   switches to the fallback music — a closed bank never runs into MAIN's give-up → silence.
 * - Fail-closed for PRIVATE banks only: if the grant lookup fails, no private bank is open — the public catalog is
 *   never affected (the media token still carries every public genre, so ordinary playback can never break here).
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { PRIVATE_BANKS, genresOfBanks, privateGenreIds, type PrivateBank } from "./private-banks";
import { CLOSE_GRACE_MS, grantEndsAt } from "./day-boundary";

type GrantTimes = { expiresAt: Date | null; closesAt?: Date | null };

/** Live = it has not ended yet (its close / end date + `graceMs` is still ahead). */
export function isGrantLive(g: GrantTimes, now: Date = new Date(), graceMs = 0): boolean {
  const end = grantEndsAt({ closesAt: g.closesAt ?? null, expiresAt: g.expiresAt });
  return end == null || end.getTime() + graceMs > now.getTime();
}

/** "catalog" = what is SEEN (ends exactly at closesAt); "token" = what can still PLAY (closesAt + grace, so no silence). */
export type AccessPurpose = "catalog" | "token";

/** Live private-bank ids of one business. Never throws (a failed lookup = none). */
export async function liveBankIdsForWorkspace(workspaceId: string | null | undefined, purpose: AccessPurpose = "catalog"): Promise<string[]> {
  if (!workspaceId) return [];
  try {
    const rows = await prisma.musicBankGrant.findMany({ where: { workspaceId }, select: { bankId: true, expiresAt: true, closesAt: true } });
    const now = new Date();
    const grace = purpose === "token" ? CLOSE_GRACE_MS : 0;
    const known = new Set(PRIVATE_BANKS.map((b) => b.id));
    return rows.filter((r) => known.has(r.bankId) && isGrantLive(r, now, grace)).map((r) => r.bankId);
  } catch (e) {
    console.warn("[music-bank/access] grant lookup failed — private banks closed:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** The private banks a business may use (a station → its business; a signed-in person → their active business). */
export async function accessiblePrivateBanks(caller: { workspaceId: string | null; purpose?: AccessPurpose }): Promise<PrivateBank[]> {
  const live = new Set(await liveBankIdsForWorkspace(caller.workspaceId, caller.purpose ?? "catalog"));
  return PRIVATE_BANKS.filter((b) => live.has(b.id));
}

/** How long after a bank ended the station still shows the notice (and the guard still recognises it). */
const NOTICE_AFTER_END_MS = 7 * 24 * 60 * 60 * 1000;

export type BankStatus = {
  bankId: string;
  name: string;
  /** open = no end set · closing = ends later (notice shows) · closed = ended (guard switches to the fallback) */
  state: "open" | "closing" | "closed";
  /** ISO — when it stops (null = open, no end) */
  endsAt: string | null;
  reason: "manual" | "payment" | "end-date" | null;
};

/**
 * The station's view of its business's private banks (components/private-bank-guard.tsx + the notice): every bank that is
 * open, closing, or ended within the last 7 days, plus the business's fallback playlist. Never throws (failure → empty).
 */
export async function bankStatusForWorkspace(workspaceId: string | null | undefined): Promise<{ banks: BankStatus[]; fallbackPlaylistId: string | null }> {
  if (!workspaceId) return { banks: [], fallbackPlaylistId: null };
  try {
    const [rows, ws] = await Promise.all([
      prisma.musicBankGrant.findMany({ where: { workspaceId }, select: { bankId: true, expiresAt: true, closesAt: true, closeReason: true } }),
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { fallbackPlaylistId: true } }),
    ]);
    const now = Date.now();
    const banks: BankStatus[] = [];
    for (const r of rows) {
      const bank = PRIVATE_BANKS.find((b) => b.id === r.bankId);
      if (!bank) continue;
      const end = grantEndsAt({ closesAt: r.closesAt, expiresAt: r.expiresAt });
      if (end && end.getTime() + NOTICE_AFTER_END_MS < now) continue; // long gone
      const reason: BankStatus["reason"] = !end
        ? null
        : r.closesAt && end.getTime() === r.closesAt.getTime()
          ? (r.closeReason === "payment" ? "payment" : "manual")
          : "end-date";
      banks.push({
        bankId: bank.id,
        name: bank.name,
        state: !end ? "open" : end.getTime() > now ? "closing" : "closed",
        endsAt: end ? end.toISOString() : null,
        reason,
      });
    }
    return { banks, fallbackPlaylistId: ws?.fallbackPlaylistId ?? null };
  } catch (e) {
    console.warn("[music-bank/access] bank status lookup failed:", e instanceof Error ? e.message : String(e));
    return { banks: [], fallbackPlaylistId: null };
  }
}

/**
 * The media-token scope for a caller: every READY genre EXCEPT private-bank genres the caller has no access to.
 * Pure on its inputs so it is testable without a database.
 */
export function scopeGenres(readyGenres: string[], openBankIds: Iterable<string>): string[] {
  const privateGenres = privateGenreIds();
  const open = genresOfBanks(openBankIds);
  return readyGenres.filter((g) => !privateGenres.has(g) || open.has(g));
}
