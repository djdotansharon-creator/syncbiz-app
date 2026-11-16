/**
 * C5 step 2 (CSP) — DRAFT policy builder. PURE (no next/fs/net), so it is unit-testable
 * (`scripts/verify-csp.ts`). READ-ONLY DRAFT: emitted only as `Content-Security-Policy-Report-Only`, and only
 * when `SYNCBIZ_CSP_REPORT_ONLY=1` (see middleware.ts) — OFF by default, so it blocks nothing and ships nothing
 * active until explicitly enabled on a TEST environment (step C).
 *
 * Origins are evidence-backed from the step-2 resource map (`Claude outputs/VONO-C5-step2-CSP-plan.md`). The
 * actual STATION playback is native MPV (outside the browser), so `media-src` never affects station audio; the
 * broad `img-src`/`media-src https:` cover the browser control-UI's arbitrary artwork / radio hosts only.
 */

export type CspOptions = {
  /** NEXT_PUBLIC_WS_URL (ws(s):// or http(s)://). The ws(s) origin is added to connect-src. */
  wsUrl?: string | null;
  /** Development build? DEV needs 'unsafe-eval' + localhost HMR websocket (Next Fast Refresh); prod does NOT. */
  dev?: boolean;
};

/** Extract the `ws://host` / `wss://host` origin from NEXT_PUBLIC_WS_URL, or null if it is not a ws url. */
export function wsConnectOrigin(wsUrl?: string | null): string | null {
  const raw = (wsUrl ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.replace(/^http(s?):/i, "ws$1:"));
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Build the CSP string. Report-Only is a transport concern (the header name), not part of the value. */
export function buildContentSecurityPolicy(opts: CspOptions = {}): string {
  const dev = opts.dev ?? process.env.NODE_ENV !== "production";
  const ws = wsConnectOrigin(opts.wsUrl ?? process.env.NEXT_PUBLIC_WS_URL ?? null);

  const YT = "https://www.youtube.com";
  const SC = "https://w.soundcloud.com";
  const MAPS = ["https://maps.googleapis.com", "https://maps.gstatic.com"];

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'", // 3 boot scripts in app/layout.tsx + Next hydration (nonce planned for the ENFORCE phase)
    dev ? "'unsafe-eval'" : null, // DEV ONLY: Next Fast Refresh / webpack HMR uses eval — never needed in prod
    YT, // youtube.com/iframe_api
    SC, // w.soundcloud.com/player/api.js
    "https://maps.googleapis.com", // Control Room Google Maps SDK (owner-gated)
  ].filter(Boolean);

  const connectSrc = [
    "'self'", // every browser fetch/XHR is same-origin /api/... ; also the sendBeacon telemetry + ws-token mint
    ws, // wss://syncbiz-ws-<env>-production.up.railway.app (per-env, from NEXT_PUBLIC_WS_URL)
    ...MAPS, // Google Maps tiles/vector fetches (owner-gated)
    dev ? "ws://localhost:*" : null, // DEV ONLY: HMR websocket
    dev ? "http://localhost:*" : null, // DEV ONLY
  ].filter(Boolean);

  const directives: Array<[string, string]> = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'self'"], // anti-clickjacking
    ["form-action", "'self'"],
    ["script-src", scriptSrc.join(" ")],
    ["style-src", "'self' 'unsafe-inline'"], // next/font inline @font-face + React inline style attributes
    ["img-src", "'self' data: https:"], // covers/thumbnails from arbitrary https hosts (operator artworkUrl, deck art)
    ["font-src", "'self' https://fonts.gstatic.com"], // next/font self-hosts; gstatic only when Maps is active
    ["media-src", "'self' blob: https:"], // /api/media + /api/jingles, HLS/MediaRecorder blobs, R2, arbitrary https radio (browser only)
    ["frame-src", `'self' ${YT} ${SC}`],
    ["connect-src", connectSrc.join(" ")],
    ["worker-src", "'self'"], // /sw.js PWA
    ["report-uri", "/api/csp-report"], // same-origin, token-sanitising endpoint — created in step C (404 is harmless in Report-Only)
  ];

  return directives.map(([k, v]) => `${k} ${v}`).join("; ");
}
