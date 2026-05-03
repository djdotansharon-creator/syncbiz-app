import type { PlaybackTrack } from "@/lib/playback-provider";
import type { Playlist } from "@/lib/playlist-types";
import type { UnifiedSource } from "@/lib/source-types";

/** Persisted taxonomy for CONTROL mirror parity (serialized on `StationPlaybackState.currentSource`). */
export type PlaylistOriginBadgeKey = "dj_creator" | "ready" | "scheduled" | "my" | "branch";

/** User-facing deck pill labels (shown uppercase in UI). */
export type DeckSourceBadgeLabels = {
  youtube: string;
  soundcloud: string;
  radio: string;
  liveStream: string;
  /** @deprecated Prefer branchPlaylist in UI — kept for older call sites */
  syncbizPlaylist: string;
  local: string;
  djCreatorPlaylist: string;
  readyPlaylist: string;
  scheduledPlaylist: string;
  myPlaylist: string;
  branchPlaylist: string;
};

export function resolvePlaylistOriginBadgeKey(playlist: Playlist | null | undefined): PlaylistOriginBadgeKey | null {
  if (!playlist) return null;
  if (playlist.libraryPlacement === "ready_external") return "ready";
  const g = (playlist.genre ?? "").trim().toLowerCase();
  if (g === "dj creator") return "dj_creator";
  if (playlist.scheduleContributorBlocks && playlist.scheduleContributorBlocks.length > 0) return "scheduled";
  if (playlist.playlistOwnershipScope === "owner_personal") return "my";
  return "branch";
}

export function labelForPlaylistOriginBadge(
  key: PlaylistOriginBadgeKey | null | undefined,
  labels: DeckSourceBadgeLabels
): string | null {
  if (!key) return null;
  switch (key) {
    case "dj_creator":
      return labels.djCreatorPlaylist;
    case "ready":
      return labels.readyPlaylist;
    case "scheduled":
      return labels.scheduledPlaylist;
    case "my":
      return labels.myPlaylist;
    case "branch":
      return labels.branchPlaylist;
    default:
      return labels.branchPlaylist;
  }
}

function labelForPlaylistFromSource(source: UnifiedSource | null | undefined, labels: DeckSourceBadgeLabels): string {
  const key = resolvePlaylistOriginBadgeKey(source?.playlist ?? null);
  return labelForPlaylistOriginBadge(key, labels) ?? labels.branchPlaylist;
}

function isYouTubeLivePath(url: string): boolean {
  return /youtube\.com\/live\//i.test(url) || /youtu\.be\/live/i.test(url);
}

/** True when URL is clearly live/stream/radio-style delivery (not arbitrary web pages). */
function isLiveOrStreamStyleUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (u.includes(".m3u8") || u.includes("m3u8?") || u.includes(".pls") || u.includes(".m3u")) return true;
  if (u.includes("icecast") || u.includes("shoutcast")) return true;
  if (/\.(aac|opus)(\?|$)/i.test(u)) return true;
  return false;
}

/**
 * Compact deck badge next to transport. Allowed meanings: YOUTUBE, SOUNDCLOUD, RADIO,
 * LIVE STREAM, playlist kinds (DJ Creator / Ready / …), LOCAL, REMOTE.
 */
export function resolveDeckSourceBadge(
  source: UnifiedSource | null | undefined,
  track: PlaybackTrack | null | undefined,
  labels: DeckSourceBadgeLabels
): string {
  const url = (track?.url ?? source?.url ?? "").trim();
  const origin = source?.origin;
  const type = track?.type ?? source?.type;

  if (!source && !track) return labels.local;
  if (origin === "radio") return labels.radio;
  if (origin === "playlist") return labelForPlaylistFromSource(source, labels);

  switch (type) {
    case "youtube":
      return isYouTubeLivePath(url) ? labels.liveStream : labels.youtube;
    case "soundcloud":
      return labels.soundcloud;
    case "spotify":
      return labels.local;
    case "stream-url":
      return isLiveOrStreamStyleUrl(url) ? labels.liveStream : labels.local;
    case "winamp":
      return labels.liveStream;
    case "local":
      return labels.local;
    default:
      return labels.local;
  }
}
