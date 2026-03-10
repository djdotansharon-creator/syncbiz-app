/**
 * Share utilities for SyncBiz.
 * Prioritizes ORIGINAL source URLs (YouTube, SoundCloud, etc.) over internal SyncBiz URLs.
 */

export const PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * Validate that a value is a valid http/https URL.
 */
export function isValidHttpUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Check if URL is internal SyncBiz or localhost (avoid as primary share target).
 */
function isInternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "localhost" ||
      u.hostname.startsWith("127.") ||
      u.hostname.includes("syncbiz") ||
      u.protocol === "syncbiz:"
    );
  } catch {
    return false;
  }
}

/** Flexible item shape for share URL resolution. */
export type ShareableItem = {
  title: string;
  id?: string;
  /** Explicit original source URL (highest priority) */
  originalSourceUrl?: string;
  sourceUrl?: string;
  /** Platform-specific URLs */
  youtubeUrl?: string;
  soundcloudUrl?: string;
  externalUrl?: string;
  embedUrl?: string;
  /** Generic URL (playback/target URL) */
  url?: string;
  platform?: string;
  type?: string;
  /** Playlist with url and tracks */
  playlist?: { url?: string; tracks?: { url: string; type?: string }[] };
  /** DB source */
  source?: { target?: string; uriOrPath?: string };
  /** Radio stream */
  radio?: { url: string };
  origin?: string;
};

/**
 * Resolve the best shareable URL for an item.
 * Priority:
 * 1. originalSourceUrl (valid)
 * 2. sourceUrl (valid)
 * 3. platform=youtube + youtubeUrl
 * 4. platform=soundcloud + soundcloudUrl
 * 5. externalUrl
 * 6. url (if valid and not internal)
 * 7. source.target / source.uriOrPath
 * 8. playlist.url or first track url
 * 9. radio.url
 * 10. Fallback: internal SyncBiz URL
 */
export function getShareableSourceUrl(
  item: ShareableItem,
  fallbackPlaylistId?: string,
  fallbackRadioId?: string
): { url: string; isFallback: boolean } {
  const candidates: string[] = [];

  if (item.originalSourceUrl && isValidHttpUrl(item.originalSourceUrl))
    candidates.push(item.originalSourceUrl.trim());
  if (item.sourceUrl && isValidHttpUrl(item.sourceUrl))
    candidates.push(item.sourceUrl.trim());
  if (
    (item.platform === "youtube" || item.type === "youtube") &&
    item.youtubeUrl &&
    isValidHttpUrl(item.youtubeUrl)
  )
    candidates.push(item.youtubeUrl.trim());
  if (
    (item.platform === "soundcloud" || item.type === "soundcloud") &&
    item.soundcloudUrl &&
    isValidHttpUrl(item.soundcloudUrl)
  )
    candidates.push(item.soundcloudUrl.trim());
  if (item.externalUrl && isValidHttpUrl(item.externalUrl))
    candidates.push(item.externalUrl.trim());
  if (item.embedUrl && isValidHttpUrl(item.embedUrl))
    candidates.push(item.embedUrl.trim());
  if (item.url && isValidHttpUrl(item.url)) candidates.push(item.url.trim());
  if (
    item.source?.target &&
    isValidHttpUrl(item.source.target)
  )
    candidates.push(item.source.target.trim());
  if (
    item.source?.uriOrPath &&
    isValidHttpUrl(item.source.uriOrPath)
  )
    candidates.push(item.source.uriOrPath.trim());
  if (item.playlist?.url && isValidHttpUrl(item.playlist.url))
    candidates.push(item.playlist.url.trim());
  if (
    item.playlist?.tracks?.[0]?.url &&
    isValidHttpUrl(item.playlist.tracks[0].url)
  )
    candidates.push(item.playlist.tracks[0].url.trim());
  if (item.radio?.url && isValidHttpUrl(item.radio.url))
    candidates.push(item.radio.url.trim());

  const external = candidates.find((u) => !isInternalUrl(u));
  if (external) return { url: external, isFallback: false };

  const anyValid = candidates.find((u) => isValidHttpUrl(u));
  if (anyValid) return { url: anyValid, isFallback: false };

  if (fallbackRadioId)
    return {
      url: `${PUBLIC_APP_URL}/radio?station=${encodeURIComponent(fallbackRadioId)}`,
      isFallback: true,
    };
  if (fallbackPlaylistId || item.id)
    return {
      url: `${PUBLIC_APP_URL}/sources?playlist=${encodeURIComponent(fallbackPlaylistId || item.id!)}`,
      isFallback: true,
    };

  return {
    url: PUBLIC_APP_URL,
    isFallback: true,
  };
}

/**
 * Build share text using the original source URL.
 */
export function getShareText(title: string, shareUrl: string): string {
  return `🎵 ${title}\nListen here:\n${shareUrl}`;
}

export type SharePlatform = "whatsapp" | "telegram" | "facebook" | "mail" | "copy";

export type ShareParams = {
  title: string;
  shareUrl: string;
  shareUrlWeb?: string;
};

export type ShareMediaOptions = {
  item: ShareableItem;
  fallbackPlaylistId?: string;
  fallbackRadioId?: string;
  /** Web URL for social sharers when shareUrl is syncbiz:// */
  shareUrlWeb?: string;
  onCopySuccess?: () => void;
  onError?: (message: string) => void;
};

/**
 * Central share function. Resolves original source URL and performs the share action.
 */
export function shareMedia(
  platform: SharePlatform,
  options: ShareMediaOptions
): void {
  const { item, fallbackPlaylistId, fallbackRadioId, shareUrlWeb, onCopySuccess, onError } =
    options;

  const { url: shareUrl } = getShareableSourceUrl(
    item,
    fallbackPlaylistId,
    fallbackRadioId
  );

  if (!isValidHttpUrl(shareUrl) && !shareUrl.startsWith("syncbiz://")) {
    onError?.("No valid URL to share");
    return;
  }

  const shareText = getShareText(item.title, shareUrl);
  const urlForWeb = shareUrl.startsWith("syncbiz://")
    ? shareUrlWeb || PUBLIC_APP_URL
    : shareUrl;

  switch (platform) {
    case "whatsapp": {
      const href = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
      window.open(href, "_blank");
      break;
    }
    case "telegram": {
      const href = `https://t.me/share/url?url=${encodeURIComponent(urlForWeb)}&text=${encodeURIComponent(item.title)}`;
      window.open(href, "_blank");
      break;
    }
    case "facebook": {
      const href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(urlForWeb)}`;
      window.open(href, "_blank");
      break;
    }
    case "mail": {
      const href = `mailto:?subject=${encodeURIComponent("SyncBiz Media Share")}&body=${encodeURIComponent(shareText)}`;
      window.location.href = href;
      break;
    }
    case "copy": {
      navigator.clipboard.writeText(shareUrl).then(
        () => onCopySuccess?.(),
        () => onError?.("Failed to copy")
      );
      break;
    }
  }
}

/** Convert UnifiedSource to ShareableItem. */
export function unifiedSourceToShareable(
  source: {
    title: string;
    id?: string;
    url?: string;
    type?: string;
    origin?: string;
    playlist?: { url?: string; tracks?: { url: string; type?: string }[] };
    source?: { target?: string; uriOrPath?: string };
    radio?: { url: string; id?: string };
  }
): ShareableItem {
  return {
    title: source.title,
    id: source.id,
    url: source.url,
    type: source.type,
    origin: source.origin,
    playlist: source.playlist,
    source: source.source,
    radio: source.radio,
  };
}

/** Convert RadioStream to ShareableItem. */
export function radioToShareable(station: {
  name: string;
  id: string;
  url: string;
}): ShareableItem {
  return {
    title: station.name,
    id: station.id,
    url: station.url,
    radio: { url: station.url },
  };
}

/** Convert Playlist to ShareableItem. */
export function playlistToShareable(playlist: {
  name: string;
  id: string;
  url?: string;
  type?: string;
  tracks?: { url: string; type?: string }[];
}): ShareableItem {
  return {
    title: playlist.name,
    id: playlist.id,
    url: playlist.url,
    type: playlist.type,
    playlist: {
      url: playlist.url,
      tracks: playlist.tracks,
    },
  };
}

/** @deprecated Use shareMedia. Kept for backward compatibility during migration. */
export function getPlaylistShareUrl(playlistId: string): string {
  return `${PUBLIC_APP_URL}/sources?playlist=${encodeURIComponent(playlistId)}`;
}

/** @deprecated Use shareMedia. Kept for backward compatibility. */
export function getRadioShareUrl(stationId: string): string {
  return `${PUBLIC_APP_URL}/radio?station=${encodeURIComponent(stationId)}`;
}

/** @deprecated Use shareMedia + getShareText. Kept for backward compatibility. */
export function sharePlaylist(
  platform: SharePlatform,
  params: ShareParams,
  onCopySuccess?: () => void
): void {
  const urlForWeb = params.shareUrlWeb || params.shareUrl;
  const shareText = getShareText(params.title, urlForWeb);

  switch (platform) {
    case "whatsapp": {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank");
      break;
    }
    case "telegram": {
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent(urlForWeb)}&text=${encodeURIComponent(params.title)}`,
        "_blank"
      );
      break;
    }
    case "facebook": {
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(urlForWeb)}`,
        "_blank"
      );
      break;
    }
    case "mail": {
      window.location.href = `mailto:?subject=${encodeURIComponent("SyncBiz Media Share")}&body=${encodeURIComponent(shareText)}`;
      break;
    }
    case "copy": {
      navigator.clipboard.writeText(urlForWeb).then(() => onCopySuccess?.());
      break;
    }
  }
}
