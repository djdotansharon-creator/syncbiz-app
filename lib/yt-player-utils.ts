/**
 * Safe YouTube IFrame API helpers.
 * The YT.Player constructor returns immediately; the real player API is only
 * available in onReady via evt.target. Never use the constructor's return value.
 */

const DEV = process.env.NODE_ENV === "development";

export interface YTPlayerAPI {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  loadVideoById?: (videoId: string, startSeconds?: number) => void;
  destroy?: () => void;
  setVolume: (vol: number) => void;
  mute?: () => void;
  unMute?: () => void;
  isMuted?: () => boolean;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  getVideoLoadedFraction?: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  /** Playlist methods – available when list/listType are used */
  getPlaylist?: () => string[];
  getPlaylistIndex?: () => number;
  getVideoData?: () => { video_id: string; title: string; author: string };
}

function hasMethod(obj: unknown, method: string): obj is YTPlayerAPI {
  return obj != null && typeof obj === "object" && typeof (obj as Record<string, unknown>)[method] === "function";
}

/** True when the player's backing iframe is still mounted (avoids setVolume on destroyed embeds). */
export function isYtPlayerIframeAlive(player: unknown): boolean {
  if (player == null || typeof player !== "object") return false;
  try {
    const getIframe = (player as { getIframe?: () => HTMLIFrameElement | null }).getIframe;
    if (typeof getIframe !== "function") return true;
    const iframe = getIframe.call(player);
    return !!iframe?.src && !!iframe.contentWindow;
  } catch {
    return false;
  }
}

/** Check if ref holds a ready YouTube player with methods and a live iframe. */
export function isYtPlayerReady(player: unknown): player is YTPlayerAPI {
  return (
    hasMethod(player, "getPlayerState") &&
    hasMethod(player, "playVideo") &&
    isYtPlayerIframeAlive(player)
  );
}

/** Safely call a YT player method. Returns false if not ready. */
export function safeYtCall<T>(
  player: unknown,
  method: keyof YTPlayerAPI,
  ...args: unknown[]
): T | undefined {
  if (!hasMethod(player, method)) {
    if (DEV) console.warn("[YT] Ignored unsupported action:", method, "- player not ready");
    return undefined;
  }
  try {
    const fn = (player as unknown as Record<string, (...a: unknown[]) => T>)[method];
    return fn.apply(player, args);
  } catch (e) {
    if (DEV) console.warn("[YT] Player method error:", method, e);
    return undefined;
  }
}

/** Safe getPlayerState - returns -1 if not ready. */
export function safeGetPlayerState(player: unknown): number {
  const state = safeYtCall<number>(player, "getPlayerState");
  return typeof state === "number" ? state : -1;
}

/** Safe setVolume - no-op if not ready. */
export function safeSetVolume(player: unknown, vol: number): void {
  safeYtCall(player, "setVolume", vol);
}

/** Safe mute - no-op if not ready or unavailable. */
export function safeMute(player: unknown): void {
  safeYtCall(player, "mute");
}

/** Safe unMute - no-op if not ready or unavailable. */
export function safeUnMute(player: unknown): void {
  safeYtCall(player, "unMute");
}

/** Safe playVideo. */
export function safePlayVideo(player: unknown): void {
  safeYtCall(player, "playVideo");
}

/** Load a new video in an existing player (single-iframe sequential transition). */
export function safeLoadVideoById(player: unknown, videoId: string, startSeconds = 0): void {
  safeYtCall(player, "loadVideoById", videoId, startSeconds);
}

/** Wait until loadVideoById has activated the target video id. */
export async function waitForYtVideoLoaded(
  player: unknown,
  videoId: string,
  opts: { timeoutMs?: number; pollMs?: number; isAborted?: () => boolean } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollMs = opts.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.isAborted?.()) return false;
    if (!isYtPlayerReady(player)) {
      await new Promise<void>((r) => setTimeout(r, pollMs));
      continue;
    }
    const data = safeGetVideoData(player);
    if (data?.video_id === videoId) {
      const st = safeGetPlayerState(player);
      const YT = typeof window !== "undefined" ? window.YT : undefined;
      if (
        YT == null ||
        st === YT.PlayerState.PLAYING ||
        st === YT.PlayerState.BUFFERING ||
        st === YT.PlayerState.PAUSED ||
        st === YT.PlayerState.CUED
      ) {
        return true;
      }
    }
    await new Promise<void>((r) => setTimeout(r, pollMs));
  }
  return false;
}

/** Safe pauseVideo. */
export function safePauseVideo(player: unknown): void {
  safeYtCall(player, "pauseVideo");
}

/** Safe stopVideo. */
export function safeStopVideo(player: unknown): void {
  safeYtCall(player, "stopVideo");
}

/** Safe destroy – removes iframe from DOM to avoid React removeChild conflict. Call before unmounting. */
export function safeDestroyYtPlayer(player: unknown): void {
  try {
    if (player != null && typeof (player as Record<string, unknown>).destroy === "function") {
      (player as { destroy: () => void }).destroy();
    }
  } catch {
    /* destroy can throw; ignore */
  }
}

/** Safe seekTo. */
export function safeSeekTo(player: unknown, sec: number, allowSeekAhead: boolean): void {
  safeYtCall(player, "seekTo", sec, allowSeekAhead);
}

/** Safe getCurrentTime. */
export function safeGetCurrentTime(player: unknown): number {
  const t = safeYtCall<number>(player, "getCurrentTime");
  return typeof t === "number" ? t : 0;
}

/** Safe getDuration. */
export function safeGetDuration(player: unknown): number {
  const d = safeYtCall<number>(player, "getDuration");
  return typeof d === "number" ? d : 0;
}

/** Safe getVideoLoadedFraction (0–1). Returns 0 if not available. */
export function safeGetVideoLoadedFraction(player: unknown): number {
  const f = safeYtCall<number>(player, "getVideoLoadedFraction");
  return typeof f === "number" && f >= 0 && f <= 1 ? f : 0;
}

/** Safe getPlaylist – returns array of video IDs, or empty array if not a playlist. */
export function safeGetPlaylist(player: unknown): string[] {
  const list = safeYtCall<string[]>(player, "getPlaylist");
  return Array.isArray(list) ? list : [];
}

/** Safe getPlaylistIndex – returns current index in playlist, or 0 if not available. */
export function safeGetPlaylistIndex(player: unknown): number {
  const idx = safeYtCall<number>(player, "getPlaylistIndex");
  return typeof idx === "number" && idx >= 0 ? idx : 0;
}

/** True when player is actively playing or buffering (audible path). */
export function isYtPlayerAudible(player: unknown): boolean {
  const YT = typeof window !== "undefined" ? window.YT : undefined;
  if (!isYtPlayerReady(player) || YT == null) return false;
  const st = safeGetPlayerState(player);
  return st === YT.PlayerState.PLAYING || st === YT.PlayerState.BUFFERING;
}

/**
 * Wait until YouTube player stays PLAYING/BUFFERING for minStableMs.
 * Used before starting manual crossfade so incoming is stable at vol 0.
 */
export async function waitForYtStandbyStable(
  player: unknown,
  opts: {
    minStableMs?: number;
    timeoutMs?: number;
    pollMs?: number;
    isAborted?: () => boolean;
  } = {},
): Promise<boolean> {
  const minStableMs = opts.minStableMs ?? 350;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const pollMs = opts.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let stableSince = 0;

  while (Date.now() < deadline) {
    if (opts.isAborted?.()) return false;
    if (isYtPlayerAudible(player)) {
      if (stableSince === 0) stableSince = Date.now();
      if (Date.now() - stableSince >= minStableMs) return true;
    } else {
      stableSince = 0;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
  return isYtPlayerAudible(player);
}

/** Safe getVideoData – returns { video_id, title, author } for current video. */
export function safeGetVideoData(player: unknown): { video_id: string; title: string; author: string } | null {
  const data = safeYtCall<{ video_id?: string; title?: string; author?: string }>(player, "getVideoData");
  if (data && typeof data === "object" && data.video_id) {
    return {
      video_id: String(data.video_id),
      title: typeof data.title === "string" ? data.title : "YouTube",
      author: typeof data.author === "string" ? data.author : "",
    };
  }
  return null;
}
