/**
 * A royalty-free music bank (a Genre Pack of the public catalog, or a private bank this business was opened to) as something the PLAYER can play —
 * client-safe (no server-only import). Owner 2026-11-12: "the royalty-free bank playlists must be in the Schedules categories, so I can schedule them".
 *
 * It is the SAME source the Royalty-Free screen builds in its Stream mode (components/royalty-free-music-workspace-panel.tsx `buildSource`):
 * an ephemeral playlist of token-free `/api/media/<id>` URLs — the MASTER adds its media token at play time, so the token never travels over WS
 * and never reaches a CONTROL. A schedule therefore plays a bank exactly like a manual click on "Listen" does; nothing in the playback chain changes.
 */
import type { MusicBankGenrePack } from "./catalog-types";
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";

export type BankPackSummary = { id: string; name: string; description: string; isPrivate: boolean };

/** the pack as a playable source; null when it has no songs */
export function bankPackToUnified(pack: MusicBankGenrePack, origin: string): UnifiedSource | null {
  const tracks: PlaylistTrack[] = pack.tracks.map((t) => ({
    id: t.id,
    name: t.title,
    type: "stream-url" as const,
    url: `${origin}/api/media/${encodeURIComponent(t.id)}`,
  }));
  if (tracks.length === 0) return null;
  const first = tracks[0]!.url;
  const playlist: Playlist = {
    id: `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}musicbank-${pack.id}-stream`,
    name: pack.name,
    genre: pack.name,
    type: "stream-url",
    url: first,
    thumbnail: "",
    createdAt: new Date().toISOString(),
    tracks,
    order: tracks.map((t) => t.id),
  };
  return { id: playlist.id, title: playlist.name, genre: pack.name, cover: null, type: "stream-url", url: first, origin: "playlist", playlist };
}

/** the private banks this person's business may use (an empty list when signed out / offline / none opened) */
async function privatePacks(): Promise<MusicBankGenrePack[]> {
  try {
    const r = await fetch("/api/music-bank/private-banks", { credentials: "include", cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { banks?: MusicBankGenrePack[] };
    return Array.isArray(j.banks) ? j.banks : [];
  } catch {
    return [];
  }
}

/** one pack by id — the public catalog first, then the private banks (the catalog is loaded only when a bank is actually needed) */
export async function findBankPack(id: string): Promise<MusicBankGenrePack | null> {
  const { POC_MUSIC_BANK_CATALOG } = await import("./poc-catalog");
  const pub = POC_MUSIC_BANK_CATALOG.genres.find((g) => g.id === id);
  if (pub) return pub;
  return (await privatePacks()).find((b) => b.id === id) ?? null;
}

/** every bank that can be scheduled here: the public Genre Packs + this business's private banks */
export async function listBankPacks(): Promise<BankPackSummary[]> {
  const { POC_MUSIC_BANK_CATALOG } = await import("./poc-catalog");
  const pub = POC_MUSIC_BANK_CATALOG.genres.map((g) => ({ id: g.id, name: g.name, description: g.description, isPrivate: false }));
  const priv = (await privatePacks()).map((b) => ({ id: b.id, name: b.name, description: b.description, isPrivate: true }));
  return [...priv, ...pub];
}
