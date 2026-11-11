/**
 * Who may use which PRIVATE music bank (owner 2026-11-10). Server-only.
 *
 * - A business (workspace) may use a private bank while it holds a LIVE MusicBankGrant (no expiry, or expiry ahead).
 * - 2026-11-11 (owner rule: "only when I switch it on should it be SEEN and HEARD"): there is NO see-everything bypass,
 *   not even for the platform owner — the catalog (signed-in person → their active business) and the media token
 *   (station → its business; person → their active business) use the SAME grant check, so seen == heard everywhere.
 *   The admin screen (Platform → Accounts) still lists every bank so the owner can open / close them.
 * - Fail-closed for PRIVATE banks only: if the grant lookup fails, no private bank is open — the public catalog is
 *   never affected (the media token still carries every public genre, so ordinary playback can never break here).
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { PRIVATE_BANKS, genresOfBanks, privateGenreIds, type PrivateBank } from "./private-banks";

export function isGrantLive(g: { expiresAt: Date | null }, now: Date = new Date()): boolean {
  return g.expiresAt == null || g.expiresAt.getTime() > now.getTime();
}

/** Live private-bank ids of one business. Never throws (a failed lookup = none). */
export async function liveBankIdsForWorkspace(workspaceId: string | null | undefined): Promise<string[]> {
  if (!workspaceId) return [];
  try {
    const rows = await prisma.musicBankGrant.findMany({ where: { workspaceId }, select: { bankId: true, expiresAt: true } });
    const now = new Date();
    const known = new Set(PRIVATE_BANKS.map((b) => b.id));
    return rows.filter((r) => known.has(r.bankId) && isGrantLive(r, now)).map((r) => r.bankId);
  } catch (e) {
    console.warn("[music-bank/access] grant lookup failed — private banks closed:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** The private banks a business may use (a station → its business; a signed-in person → their active business). */
export async function accessiblePrivateBanks(caller: { workspaceId: string | null }): Promise<PrivateBank[]> {
  const live = new Set(await liveBankIdsForWorkspace(caller.workspaceId));
  return PRIVATE_BANKS.filter((b) => live.has(b.id));
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
