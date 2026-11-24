/**
 * Is this saved playlist really a SINGLE SONG? (owner 2026-11-24: "a single and a playlist must be told apart — the music list in scheduling mixed them".) PURE.
 *
 * A song saved from a search is stored as a ONE-track playlist; the library has always shown it as a single (under All / Recently Added, never under Playlists). The scheduling picker listed every stored playlist as a
 * "Playlist", so a saved song appeared there with "1 song". This uses the library's OWN rule (`classifyLibraryEntityContract` on the same shell the library builds), so the two screens can never disagree:
 * a user-made container (`local://user-playlist/…`) is always a playlist even with one track, an external playlist link is a playlist, and a plain one-track entry is a single.
 */
import type { Playlist } from "@/lib/playlist-types";
import { classifyLibraryEntityContract, type UnifiedSource } from "@/lib/source-types";

export function isSinglePlaylist(p: Playlist): boolean {
  const shell: UnifiedSource = {
    id: p.id,
    title: p.name,
    genre: p.genre || "Mixed",
    cover: null,
    type: (p.type ?? "stream-url") as UnifiedSource["type"],
    url: p.url,
    origin: "playlist",
    playlist: p,
    ...(p.libraryPlacement === "ready_external" ? { contentNodeKind: "external_playlist" as const } : {}),
  };
  return classifyLibraryEntityContract(shell).entityKind === "item";
}

/** a single track this long or longer is a SET / MIX (a DJ set, a long mix) — the same 15 minutes the library uses for its "Set" badge (owner 2026-11-24: "over 15 minutes"). */
export const SET_MIN_SECONDS = 15 * 60;

/** what a stored playlist is called in the scheduling music list: a real playlist, a single, or a set / mix. `seconds` = its known length (null = not known → a single). */
export function pickerKindOf(p: Playlist, seconds: number | null): "playlist" | "single" | "set" {
  if (!isSinglePlaylist(p)) return "playlist";
  return seconds !== null && seconds >= SET_MIN_SECONDS ? "set" : "single";
}
