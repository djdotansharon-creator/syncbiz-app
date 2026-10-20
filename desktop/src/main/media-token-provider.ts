/**
 * beta.22 — STATION media token (owner-approved 2026-10-11). The designated station's MAIN obtains the Music Bank
 * media-session token ITSELF and appends it ONLY to this server's own `/api/media/<logicalId>` URLs right before they
 * enter MPV (MpvManager.play — the single choke point for every load).
 *
 *  - Auth = station identity: `Authorization: Bearer <desktop_access>` (the signed, station-bound token MAIN already
 *    holds) → POST <apiBase>/api/music-bank/authorize. No user cookie, no renderer involvement.
 *  - The token never travels over WS, is never persisted, never logged (redactMediaToken covers MPV log lines) and
 *    never appended to any other host / path.
 *  - Refreshed in the background: at start, on desktop-auth apply, every minute when missing or < 10 min left, and on
 *    demand when a media URL is loaded without a fresh token (in-flight de-dupe + 15 s back-off after a failure).
 *  - Fail-safe: no token / refresh failure → the URL is loaded unchanged (exactly today's behaviour); a token that
 *    is still valid is kept on a failed refresh.
 */
export type MediaTokenConfigView = { apiBaseUrl?: string | null; wsToken?: string | null };
export type MediaTokenProviderDeps = {
  getConfig: () => MediaTokenConfigView;
  fetchFn?: typeof fetch;
  now?: () => number;
  log?: (level: "INFO" | "WARN", msg: string, data?: Record<string, unknown>) => void;
};

const REFRESH_BEFORE_MS = 10 * 60 * 1000;
const MIN_VALID_MS = 30 * 1000;
const FAIL_BACKOFF_MS = 15 * 1000;
const TIMEOUT_MS = 8000;
const TICK_MS = 60 * 1000;

function apiOrigin(apiBaseUrl: string | null | undefined): string | null {
  try {
    const u = new URL(String(apiBaseUrl ?? "").trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Only THIS server's media route — never another host, never a look-alike path. */
export function isOwnMediaUrl(url: string, apiBaseUrl: string | null | undefined): boolean {
  const origin = apiOrigin(apiBaseUrl);
  if (!origin) return false;
  try {
    const u = new URL(url);
    return u.origin === origin && /^\/api\/media\/[^/]+$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** Append `mt=<token>` (never twice). */
export function appendMt(url: string, token: string): string {
  if (/[?&]mt=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}mt=${encodeURIComponent(token)}`;
}

export class MediaTokenProvider {
  private token: string | null = null;
  private expMs = 0;
  private inflight: Promise<void> | null = null;
  private lastFailMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly deps: MediaTokenProviderDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** SYNC (hot path): the URL MPV should load. Unchanged unless it is our media URL and a fresh token exists. */
  withToken(url: string): string {
    const cfg = this.deps.getConfig();
    if (!isOwnMediaUrl(url, cfg.apiBaseUrl)) return url;
    const left = this.expMs - this.now();
    if (!this.token || left < REFRESH_BEFORE_MS) void this.refresh("on-demand");
    return this.token && left > MIN_VALID_MS ? appendMt(url, this.token) : url;
  }

  /** De-duplicated background refresh. Never throws. */
  refresh(reason: string): Promise<void> {
    if (this.inflight) return this.inflight;
    if (reason === "on-demand" && this.now() - this.lastFailMs < FAIL_BACKOFF_MS) return Promise.resolve();
    const cfg = this.deps.getConfig();
    const origin = apiOrigin(cfg.apiBaseUrl);
    const bearer = String(cfg.wsToken ?? "").trim();
    if (!origin || !bearer) return Promise.resolve();
    const f = this.deps.fetchFn ?? fetch;
    this.inflight = (async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await f(`${origin}/api/music-bank/authorize`, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json" },
          body: "{}",
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { token?: unknown; exp?: unknown };
        if (res.ok && typeof data.token === "string" && data.token && typeof data.exp === "number") {
          this.token = data.token;
          this.expMs = data.exp * 1000;
          this.deps.log?.("INFO", "MEDIA_TOKEN_REFRESHED", { reason, validForSec: Math.round((this.expMs - this.now()) / 1000) });
        } else {
          this.lastFailMs = this.now();
          this.deps.log?.("WARN", "MEDIA_TOKEN_REFRESH_FAILED", { reason, httpStatus: res.status });
        }
      } catch (e) {
        this.lastFailMs = this.now();
        this.deps.log?.("WARN", "MEDIA_TOKEN_REFRESH_FAILED", { reason, err: (e as Error)?.name ?? "error" });
      } finally {
        clearTimeout(t);
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  start(): void {
    if (this.timer) return;
    void this.refresh("start");
    this.timer = setInterval(() => {
      if (!this.token || this.expMs - this.now() < REFRESH_BEFORE_MS) void this.refresh("tick");
    }, TICK_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** test/diagnostic: is a usable token held? (never exposes the token) */
  hasFreshToken(): boolean {
    return !!this.token && this.expMs - this.now() > MIN_VALID_MS;
  }
}

let instance: MediaTokenProvider | null = null;

/** Wire once from MAIN (ipc-mvp) with the effective runtime config; starts the background refresh. */
export function initStationMediaToken(deps: MediaTokenProviderDeps): MediaTokenProvider {
  if (!instance) {
    instance = new MediaTokenProvider(deps);
    instance.start();
  }
  return instance;
}

/** Desktop auth changed (new desktop_access) → refresh now. */
export function refreshStationMediaToken(reason: string): void {
  void instance?.refresh(reason);
}

/** MpvManager.play hot path. Identity before init or for any non-media URL. */
export function withStationMediaToken(url: string): string {
  return instance ? instance.withToken(url) : url;
}
