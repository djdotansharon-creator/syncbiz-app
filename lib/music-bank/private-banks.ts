/**
 * PRIVATE ("secret") music banks — owner 2026-11-10.
 *
 * A private bank shows and plays ONLY for the businesses the platform owner opened it to (Platform → Businesses →
 * a business → Music banks). Everything here is SERVER-ONLY: the track list must never ship in the browser bundle,
 * so no client component imports this file (scripts/verify-private-music-banks.ts guards it). Clients get the list
 * from GET /api/music-bank/private-banks, which answers only with the banks the caller's business may use.
 *
 * `genreIds` are the media-token scope keys (MediaAsset.genreId) of the bank's songs: a business without a live
 * grant never gets them in its media token, so /api/media refuses the songs even when someone knows the address.
 */
import "server-only";
import type { MusicBankGenrePack, MusicBankSampleTrack } from "./catalog-types";
import { SHUFERSAL_DEMO_TRACKS } from "./shufersal-demo-catalog";

export type PrivateBank = {
  /** Stable id stored in MusicBankGrant.bankId. Never rename. */
  id: string;
  name: string;
  description: string;
  /** Media-token scope keys (MediaAsset.genreId) of the bank's songs. */
  genreIds: string[];
  gradient: [string, string];
  tracks: MusicBankSampleTrack[];
};

/** A fixed mix: the songs come from several styles, so a stable shuffle (by their hashed ids) alternates them. */
function mixed(tracks: MusicBankSampleTrack[]): MusicBankSampleTrack[] {
  return [...tracks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const PRIVATE_BANKS: PrivateBank[] = [
  {
    id: "all-day-mix",
    name: "All Day Mix",
    description: "A professional all-day retail mix — Latin, jazz, soul, hip hop and café styles, alternating through the day.",
    genreIds: ["shufersal-demo"],
    gradient: ["#16233f", "#ff9e5a"],
    tracks: mixed(SHUFERSAL_DEMO_TRACKS),
  },
];

export function privateBankById(id: string): PrivateBank | null {
  return PRIVATE_BANKS.find((b) => b.id === id) ?? null;
}

/** Every media-token genre that belongs to some private bank (these are never handed out without a grant). */
export function privateGenreIds(): Set<string> {
  return new Set(PRIVATE_BANKS.flatMap((b) => b.genreIds));
}

/** The genres a set of live bank grants opens. */
export function genresOfBanks(bankIds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of bankIds) for (const g of privateBankById(id)?.genreIds ?? []) out.add(g);
  return out;
}

/** The client shape: a bank drawn like a Genre Pack in the Royalty-Free catalog. */
export function privateBankAsPack(b: PrivateBank): MusicBankGenrePack {
  return { id: b.id, name: b.name, driveFolder: "", folderId: "", description: b.description, gradient: b.gradient, priceLabel: null, entitlement: null, tracks: b.tracks };
}
