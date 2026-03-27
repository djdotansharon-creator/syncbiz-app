import type { PlaybackTrack } from "@/lib/playback-provider";
import type { UnifiedSource } from "@/lib/source-types";

/** User-facing deck pill labels (shown uppercase in UI). */
export type DeckSourceBadgeLabels = {
  youtube: string;
  soundcloud: string;
  radio: string;
  liveStream: string;
  syncbizPlaylist: string;
  local: string;
};

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
 * LIVE STREAM, SYNCBIZ PLAYLIST, LOCAL, REMOTE.
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
  if (origin === "playlist") return labels.syncbizPlaylist;

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
