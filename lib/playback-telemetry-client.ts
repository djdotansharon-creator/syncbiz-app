/**
 * Owner-side playback telemetry (client → /api/telemetry/incidents).
 *
 * This exists so the platform owner can monitor playback reliability across ALL
 * customers from /admin/platform/telemetry — proactively, without waiting for a
 * customer to phone in a "the music froze" complaint.
 *
 * IRON RULE: telemetry must NEVER affect playback. Every call here is
 * fire-and-forget — it never awaits on the transport hot path, never throws, and
 * is rate-limited so a stuck player can't flood the endpoint. If the network or
 * endpoint is down, the player neither knows nor cares.
 */

export type PlaybackIncidentKind =
  | "freeze" // detected: intent playing, MPV playing, but position frozen
  | "self_heal_redispatch" // watchdog re-issued loadfile to recover
  | "skip_recover" // gave up after retries and skipped forward to keep audio alive
  | "recovered" // playback resumed after an intervention
  | "stall_error"; // engine/stall error surfaced

export interface PlaybackIncidentPayload {
  kind: PlaybackIncidentKind;
  deviceId?: string | null;
  branchId?: string | null;
  deviceMode?: string | null;
  platform?: string | null;
  sourceType?: string | null;
  sourceTitle?: string | null;
  urlHost?: string | null;
  attempt?: number | null;
  frozenMs?: number | null;
  recovered?: boolean | null;
  mpvStatus?: string | null;
  engineReady?: boolean | null;
  appVersion?: string | null;
  detail?: Record<string, unknown> | null;
}

/** Reduce any URL to its host only — never send full URLs (they can carry tokens). */
export function hostOnly(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Coarse source classification for the dashboard (no secrets). */
export function classifySource(url: string | null | undefined): string {
  if (!url) return "none";
  const low = url.toLowerCase();
  if (low.startsWith("file:") || low.startsWith("/") || /^[a-z]:\\/i.test(url)) return "local-file";
  if (low.includes("youtube.com") || low.includes("youtu.be") || low.startsWith("ytdl:")) return "youtube";
  if (low.includes("soundcloud")) return "soundcloud";
  if (low.startsWith("http")) return "http-stream";
  return "other";
}

// At most one report per kind per this window — a stuck player must not flood.
const RATE_WINDOW_MS = 4000;
const lastSentByKind: Record<string, number> = {};

/**
 * Fire-and-forget playback telemetry. Safe to call from anywhere in the
 * playback path — it returns immediately and swallows every error.
 */
export function reportPlaybackIncident(payload: PlaybackIncidentPayload): void {
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    const now = Date.now();
    const key = payload.kind;
    const last = lastSentByKind[key] ?? 0;
    if (now - last < RATE_WINDOW_MS) return;
    lastSentByKind[key] = now;

    const body = JSON.stringify({ ...payload, ts: now });
    const url = "/api/telemetry/incidents";

    // sendBeacon is the ideal transport: truly async, survives navigation/unload,
    // sends same-origin cookies (so the session authenticates it).
    if (typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      if (ok) return;
    }
    // Fallback — keepalive fetch, errors ignored.
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    /* telemetry must never affect playback */
  }
}
