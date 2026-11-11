/**
 * Music Bank → a playable STREAM source (pure, client-safe). The SAME shape the Royalty-Free panel builds in stream mode
 * (components/royalty-free-music-workspace-panel.tsx buildSource): an ephemeral playlist of token-free `/api/media/<id>`
 * URLs; the MASTER (station MAIN) appends its own media token at play time — the token never travels over WS.
 * Used by the private-bank guard for the default FALLBACK MUSIC (owner 2026-11-11).
 */
import { EPHEMERAL_LOCAL_PLAYLIST_PREFIX } from "@/lib/local-playlist-artwork";
import type { Playlist, PlaylistTrack } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";
import { POC_MUSIC_BANK_CATALOG } from "@/lib/music-bank/poc-catalog";

/** Id prefix of every Music Bank stream source: `ephemeral-local-folder:musicbank-<packId>-stream`. */
export function musicBankStreamSourceId(packId: string): string {
  return `${EPHEMERAL_LOCAL_PLAYLIST_PREFIX}musicbank-${packId}-stream`;
}

/** Does this MAIN library / source id belong to pack (bank) `packId`? (MAIN reports `<sourceId>:track:r<N>`.) */
export function isMusicBankSourceOf(id: string | null | undefined, packId: string): boolean {
  return typeof id === "string" && id.startsWith(musicBankStreamSourceId(packId));
}

export function buildMusicBankStreamSource(
  pack: { id: string; name: string },
  tracks: Array<{ id: string; title: string }>,
  origin: string,
): UnifiedSource | null {
  const plTracks: PlaylistTrack[] = tracks.map((t) => ({
    id: t.id,
    name: t.title,
    type: "stream-url" as const,
    url: `${origin}/api/media/${encodeURIComponent(t.id)}`,
  }));
  if (plTracks.length === 0) return null;
  const first = plTracks[0].url;
  const playlist: Playlist = {
    id: musicBankStreamSourceId(pack.id),
    name: pack.name,
    genre: pack.name,
    type: "stream-url",
    url: first,
    thumbnail: "",
    createdAt: new Date().toISOString(),
    tracks: plTracks,
    order: plTracks.map((t) => t.id),
  };
  return { id: playlist.id, title: playlist.name, genre: pack.name, cover: null, type: "stream-url", url: first, origin: "playlist", playlist };
}

/** Deterministic interleave (one track from each genre in turn) — a calm mixed order, not a shuffle that changes per call. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** The default FALLBACK MUSIC: every public Royalty-Free genre pack, interleaved (all genres are always in the media token). */
export function buildGeneralMixFallbackSource(origin: string): UnifiedSource | null {
  const tracks = interleave(POC_MUSIC_BANK_CATALOG.genres.map((g) => g.tracks));
  return buildMusicBankStreamSource({ id: "fallback-mix", name: "VONO Mix" }, tracks, origin);
}
