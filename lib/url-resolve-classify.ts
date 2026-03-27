/**
 * Deterministic URL → resolve metadata (metadata only; no playback or I/O).
 * Prefer conservative classification over wrong overconfidence.
 */

import { getYouTubePlaylistId, isYouTubeMixUrl } from "./playlist-utils";
import type {
  ContentNodeKind,
  EngineSelectionPolicy,
  ExecutionTarget,
  MixStrategyId,
  ResolveMediaKind,
} from "./types";

export type ClassifyResolveContext = {
  rawUrl: string;
  inferredType: string;
  isRadio: boolean;
  isShazam: boolean;
};

type FoundationHints = {
  contentNodeKind: ContentNodeKind;
  executionTarget: ExecutionTarget;
  engineSelectionPolicy: EngineSelectionPolicy;
  mixStrategyHint?: MixStrategyId;
  mediaKind?: ResolveMediaKind;
};

const browserPrefer: Pick<FoundationHints, "executionTarget" | "engineSelectionPolicy"> = {
  executionTarget: "browser_embed",
  engineSelectionPolicy: "prefer_browser",
};

function isYouTubeHost(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes("youtube.com") || u.includes("youtu.be");
}

/** Video id from common YouTube URL shapes (incl. shorts); no network. */
function youtubeSingleVideoSignals(url: string): boolean {
  const u = url.trim();
  if (/youtube\.com\/shorts\/[^/?\s]+/i.test(u)) return true;
  if (getYouTubePlaylistId(u)) return false;
  if (/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?/]+)/i.test(u)) return true;
  return false;
}

function spotifyPathKind(url: string): ContentNodeKind | null {
  const u = url.toLowerCase();
  if (!u.includes("spotify.com") && !u.includes("open.spotify.com")) return null;
  if (/\/playlist\//i.test(url)) return "external_playlist";
  if (/\/album\//i.test(url)) return "external_playlist";
  if (/\/track\//i.test(url)) return "single_track";
  if (/\/episode\//i.test(url)) return "single_track";
  return null;
}

function soundcloudPathKind(url: string): ContentNodeKind | null {
  const u = url.toLowerCase();
  if (!u.includes("soundcloud.com")) return null;
  if (/\/sets\//i.test(url)) return "external_playlist";
  try {
    const seg = new URL(url).pathname.toLowerCase().split("/").filter(Boolean);
    const hub = seg[0];
    if (!hub || ["discover", "charts", "popular", "stream", "upload", "you", "pages", "search"].includes(hub)) {
      return null;
    }
  } catch {
    return null;
  }
  return "single_track";
}

/**
 * Maps an incoming URL + inferred provider flags to foundation hints.
 */
export function classifyResolveFoundation(ctx: ClassifyResolveContext): FoundationHints {
  const { rawUrl, inferredType, isRadio, isShazam } = ctx;

  if (isRadio) {
    return {
      contentNodeKind: "radio_stream",
      executionTarget: "radio_stream",
      engineSelectionPolicy: "prefer_browser",
      mixStrategyHint: "default",
      mediaKind: "stream",
    };
  }

  if (isShazam) {
    return {
      contentNodeKind: "single_track",
      ...browserPrefer,
      mixStrategyHint: "default",
      mediaKind: "single_track",
    };
  }

  if (inferredType === "youtube" || isYouTubeHost(rawUrl)) {
    const listId = getYouTubePlaylistId(rawUrl);
    const mixLike = isYouTubeMixUrl(rawUrl);

    if (mixLike || (listId && /^RD/i.test(listId))) {
      return {
        contentNodeKind: "mix_set",
        ...browserPrefer,
        mixStrategyHint: "browser_overlap",
        mediaKind: "multi_item",
      };
    }
    if (listId && /^PL/i.test(listId)) {
      return {
        contentNodeKind: "external_playlist",
        ...browserPrefer,
        mixStrategyHint: "browser_overlap",
        mediaKind: "multi_item",
      };
    }
    if (listId) {
      return {
        contentNodeKind: "unknown",
        ...browserPrefer,
        mediaKind: "unknown",
      };
    }
    if (youtubeSingleVideoSignals(rawUrl)) {
      return {
        contentNodeKind: "single_track",
        ...browserPrefer,
        mixStrategyHint: "default",
        mediaKind: "single_track",
      };
    }
    if (/youtube\.com\/playlist\?/i.test(rawUrl)) {
      return {
        contentNodeKind: "unknown",
        ...browserPrefer,
        mediaKind: "unknown",
      };
    }
    return {
      contentNodeKind: "unknown",
      ...browserPrefer,
      mediaKind: "unknown",
    };
  }

  const sp = spotifyPathKind(rawUrl);
  if (sp !== null) {
    const multi = sp === "external_playlist";
    return {
      contentNodeKind: sp,
      ...browserPrefer,
      mixStrategyHint: multi ? "browser_overlap" : "default",
      mediaKind: multi ? "multi_item" : "single_track",
    };
  }
  if (inferredType === "spotify") {
    return {
      contentNodeKind: "unknown",
      ...browserPrefer,
      mediaKind: "unknown",
    };
  }

  const sc = soundcloudPathKind(rawUrl);
  if (sc !== null) {
    const multi = sc === "external_playlist";
    return {
      contentNodeKind: sc,
      ...browserPrefer,
      mixStrategyHint: multi ? "browser_overlap" : "default",
      mediaKind: multi ? "multi_item" : "single_track",
    };
  }
  if (inferredType === "soundcloud") {
    return {
      contentNodeKind: "unknown",
      ...browserPrefer,
      mediaKind: "unknown",
    };
  }

  if (inferredType === "winamp") {
    return {
      contentNodeKind: "radio_stream",
      executionTarget: "radio_stream",
      engineSelectionPolicy: "prefer_browser",
      mixStrategyHint: "default",
      mediaKind: "stream",
    };
  }

  if (inferredType === "stream-url") {
    return {
      contentNodeKind: "unknown",
      ...browserPrefer,
      mediaKind: "unknown",
    };
  }

  if (inferredType === "local") {
    return {
      contentNodeKind: "unknown",
      executionTarget: "browser_embed",
      engineSelectionPolicy: "prefer_browser",
      mediaKind: "unknown",
    };
  }

  return {
    contentNodeKind: "unknown",
    ...browserPrefer,
    mediaKind: "unknown",
  };
}
