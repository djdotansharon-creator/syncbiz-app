/**
 * C5 step 2 — deterministic validation of the CSP draft builder (`lib/csp.ts`). No browser, no network.
 * Confirms every mapped origin is present, dev-only relaxations appear only in dev, and token-bearing same-origin
 * paths are NOT blocked (their directives include 'self').
 *
 * Run: npx tsx scripts/verify-csp.ts
 */
import { buildContentSecurityPolicy, wsConnectOrigin } from "../lib/csp";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
function directive(csp: string, name: string): string {
  const seg = csp.split(";").map((s) => s.trim()).find((s) => s === name || s.startsWith(name + " "));
  return seg ? seg.slice(name.length).trim() : "";
}

const WS_PROD = "wss://syncbiz-ws-production.up.railway.app";
const prod = buildContentSecurityPolicy({ wsUrl: WS_PROD, dev: false });
const dev = buildContentSecurityPolicy({ wsUrl: "ws://localhost:3001", dev: true });

// wsConnectOrigin
assert("wsConnectOrigin keeps wss origin", wsConnectOrigin(WS_PROD) === WS_PROD);
assert("wsConnectOrigin converts http(s)→ws(s)", wsConnectOrigin("https://x.railway.app") === "wss://x.railway.app");
assert("wsConnectOrigin strips path/query", wsConnectOrigin("wss://h.app/socket?t=1") === "wss://h.app");
assert("wsConnectOrigin rejects junk", wsConnectOrigin("") === null && wsConnectOrigin("not a url") === null);

// Hardening directives present
for (const [k, v] of [["default-src", "'self'"], ["object-src", "'none'"], ["base-uri", "'self'"], ["frame-ancestors", "'self'"], ["form-action", "'self'"], ["worker-src", "'self'"]] as const) {
  assert(`${k} = ${v}`, directive(prod, k) === v);
}

// frame-src
const frame = directive(prod, "frame-src");
assert("frame-src youtube + soundcloud", frame.includes("https://www.youtube.com") && frame.includes("https://w.soundcloud.com"));

// script-src
const scriptP = directive(prod, "script-src");
assert("script-src youtube/soundcloud/maps", scriptP.includes("https://www.youtube.com") && scriptP.includes("https://w.soundcloud.com") && scriptP.includes("https://maps.googleapis.com"));
assert("script-src 'unsafe-inline' (boot scripts)", scriptP.includes("'unsafe-inline'"));
assert("PROD script-src has NO 'unsafe-eval'", !scriptP.includes("'unsafe-eval'"));
assert("DEV script-src ADDS 'unsafe-eval' (Fast Refresh)", directive(dev, "script-src").includes("'unsafe-eval'"));

// connect-src
const connP = directive(prod, "connect-src");
assert("connect-src 'self' + per-env wss", connP.includes("'self'") && connP.includes(WS_PROD));
assert("connect-src maps", connP.includes("https://maps.googleapis.com"));
assert("PROD connect-src has NO localhost HMR", !connP.includes("localhost"));
assert("DEV connect-src ADDS localhost HMR ws", directive(dev, "connect-src").includes("ws://localhost:*"));

// media-src / img-src (browser arbitrary hosts) + token-bearing paths allowed via 'self'
const media = directive(prod, "media-src");
assert("media-src 'self' blob: https:", media.includes("'self'") && media.includes("blob:") && media.includes("https:"));
assert("img-src 'self' data: https:", directive(prod, "img-src") === "'self' data: https:");
// /api/media?mt=<token> and /api/auth/ws-token are same-origin → covered by 'self' in media-src/connect-src → NOT blocked → not reported
assert("token-bearing /api/media covered by media-src 'self'", media.split(" ").includes("'self'"));
assert("token-bearing /api/auth/ws-token covered by connect-src 'self'", connP.split(" ").includes("'self'"));

// font-src self-hosted
assert("font-src 'self' (next/font self-hosts)", directive(prod, "font-src").startsWith("'self'"));

// No third-party analytics / exfil origins leaked in
assert("no analytics/third-party origins", !/google-analytics|googletagmanager|sentry|posthog|datadog|mixpanel|hotjar/i.test(prod));

// report-uri is same-origin
assert("report-uri same-origin /api/csp-report", directive(prod, "report-uri") === "/api/csp-report");

console.log(`\n${pass} passed, ${fail} failed`);
console.log("\n--- PROD CSP draft ---\n" + prod);
process.exit(process.exitCode ?? 0);
