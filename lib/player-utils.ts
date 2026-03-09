import type { Source, SourceProvider, PlayerMode } from "./types";

/** Detect provider from target URL. */
export function detectProvider(target: string): SourceProvider {
  const url = target.toLowerCase();
  if (
    url.includes("youtube.com/watch") ||
    url.includes("youtu.be/") ||
    url.includes("youtube.com/embed/")
  ) {
    return "youtube";
  }
  if (url.includes("soundcloud.com")) {
    return "soundcloud";
  }
  return "external";
}

/** Infer player mode from provider. */
export function inferPlayerMode(provider: SourceProvider): PlayerMode {
  return provider === "external" ? "external" : "embedded";
}

/** Resolve provider and playerMode for a source (use explicit values or infer from target). */
export function resolveSourcePlayerInfo(source: Source): {
  provider: SourceProvider;
  playerMode: PlayerMode;
} {
  const provider = source.provider ?? detectProvider(source.target);
  const playerMode =
    source.playerMode ?? inferPlayerMode(provider);
  return { provider, playerMode };
}

/** Check if source supports embedded playback in /player. */
export function supportsEmbedded(source: Source): boolean {
  const { playerMode } = resolveSourcePlayerInfo(source);
  return playerMode === "embedded";
}

/** Extract YouTube video ID from various URL formats. */
export function getYouTubeVideoId(target: string): string | null {
  const url = target.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Build YouTube embed URL for IFrame API. */
export function getYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?enablejsapi=1`;
}

/** Check if target is a valid SoundCloud URL for embedding. */
export function isSoundCloudUrl(target: string): boolean {
  return target.toLowerCase().includes("soundcloud.com");
}

/** Build SoundCloud embed URL (used in iframe src). */
export function getSoundCloudEmbedUrl(target: string): string {
  const encoded = encodeURIComponent(target);
  return `https://w.soundcloud.com/player/?url=${encoded}&color=%231db954&auto_play=false`;
}

/** Icon type for source badge (YouTube, SoundCloud, local playlist, or external). */
export type SourceIconType = "youtube" | "soundcloud" | "local" | "external";

/** Resolve which icon to show for a source. */
export function getSourceIconType(source: Source): SourceIconType {
  const { provider } = resolveSourcePlayerInfo(source);
  if (provider === "youtube") return "youtube";
  if (provider === "soundcloud") return "soundcloud";
  if (source.type === "local_playlist" || source.type === "app_target") return "local";
  return "external";
}

/** Get artwork URL for a source (YouTube thumbnail, SoundCloud via artworkUrl, or null). */
export function getSourceArtworkUrl(source: Source): string | null {
  if (source.artworkUrl) return source.artworkUrl;
  const vid = getYouTubeVideoId(source.target);
  if (vid) return `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
  return null;
}
