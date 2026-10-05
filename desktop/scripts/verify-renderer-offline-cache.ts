/**
 * OFFLINE COLD BOOT — last-known-good renderer cache. Deterministic coverage (pure logic + real fs in a temp dir +
 * static wiring guards in index.ts). The two Electron runtime assumptions (session.fetch auth context, same-origin
 * protocol.handle interception) are proven separately by scripts/electron-proof-offline-cache.cjs (real Electron).
 *
 * Run (from desktop/): npx tsx scripts/verify-renderer-offline-cache.ts
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OFFLINE_ROUTE,
  cacheRootFor,
  captureRendererCache,
  isCacheableResource,
  isNetworkClassLoadError,
  lookupCachedResponse,
  validateCache,
  type CaptureFetch,
} from "../src/main/renderer-offline-cache";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "..", ...p), "utf-8").replace(/\r\n/g, "\n");

const ORIGIN = "https://syncbiz-app-test-production.up.railway.app";
const DOC = ORIGIN + OFFLINE_ROUTE;
const JS = ORIGIN + "/_next/static/chunks/aaa111.js";
const CSS = ORIGIN + "/_next/static/chunks/bbb222.css";
const FONT = ORIGIN + "/_next/static/media/ccc333.woff2";

/** In-memory "server": url → body/status. Never returns any header except content-type. */
function server(map: Record<string, { status?: number; body: string; type?: string }>): CaptureFetch {
  return async (url) => {
    const e = map[url];
    const status = e ? e.status ?? 200 : 404;
    const body = Buffer.from(e?.body ?? "");
    return {
      status,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? e?.type ?? "text/plain" : null) },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
}
const BUILD_A = {
  [DOC]: { body: "<html>build-A</html>", type: "text/html" },
  [JS]: { body: "console.log('A')", type: "application/javascript" },
  [CSS]: { body: "body{}", type: "text/css" },
  [FONT]: { body: "FONT", type: "font/woff2" },
};

const tmp = mkdtempSync(path.join(os.tmpdir(), "vono-rcache-"));
const freshRoot = (n: string) => cacheRootFor(path.join(tmp, n), ORIGIN);

(async () => {
  // ── classification (#10: API/auth/WS/XHR/RSC/foreign never cached) ────────────────────────────────────────
  const R = (url: string, resourceType: string, statusCode = 200, method = "GET") => ({ url, resourceType, statusCode, method });
  assert("document /sources (mainFrame) cacheable", isCacheableResource(R(DOC, "mainFrame"), ORIGIN));
  assert("static script cacheable", isCacheableResource(R(JS, "script"), ORIGIN));
  assert("stylesheet/font/image cacheable",
    isCacheableResource(R(CSS, "stylesheet"), ORIGIN) && isCacheableResource(R(FONT, "font"), ORIGIN) &&
    isCacheableResource(R(ORIGIN + "/icon.png", "image"), ORIGIN));
  assert("#10 /api/* never cached (even as script)", !isCacheableResource(R(ORIGIN + "/api/auth/me", "script"), ORIGIN));
  assert("#10 auth endpoint xhr never cached", !isCacheableResource(R(ORIGIN + "/api/auth/desktop/token-from-session", "xhr", 200, "POST"), ORIGIN));
  assert("#10 WebSocket never cached", !isCacheableResource(R("wss://syncbiz-ws-test-production.up.railway.app/", "webSocket"), ORIGIN)
    && !isCacheableResource(R(ORIGIN + "/ws", "webSocket"), ORIGIN));
  assert("#10 XHR / RSC payload never cached",
    !isCacheableResource(R(ORIGIN + "/radio?_rsc=abc", "xhr"), ORIGIN) && !isCacheableResource(R(ORIGIN + "/sources?_rsc=1", "script"), ORIGIN));
  assert("foreign origin never cached", !isCacheableResource(R("https://i.ytimg.com/vi/x/hq.jpg", "image"), ORIGIN));
  assert("non-200 / non-GET never cached",
    !isCacheableResource(R(JS, "script", 500), ORIGIN) && !isCacheableResource(R(JS, "script", 200, "POST"), ORIGIN));
  assert("other main-frame routes (/, /login) not cached as the document",
    !isCacheableResource(R(ORIGIN + "/", "mainFrame"), ORIGIN) && !isCacheableResource(R(ORIGIN + "/login", "mainFrame"), ORIGIN));

  // ── #8 / #9 network-class failure vs HTTP 5xx ─────────────────────────────────────────────────────────────
  assert("#8 ERR_INTERNET_DISCONNECTED (-106) is network-class", isNetworkClassLoadError(-106));
  assert("#8 DNS / refused / timeout / proxy-down are network-class", [-105, -137, -102, -118, -7, -109, -130].every(isNetworkClassLoadError));
  assert("ERR_ABORTED (-3) is NOT network-class", !isNetworkClassLoadError(-3));
  assert("HTTP-ish / other codes are NOT network-class", ![-300, -310, -200, 500, 0].some(isNetworkClassLoadError));

  // ── #11 online successful load → cache refresh (complete build, manifest, hashes) ─────────────────────────
  const root = freshRoot("a");
  const c1 = await captureRendererCache({ root, origin: ORIGIN, urls: [DOC, JS, CSS, FONT], fetchFn: server(BUILD_A), now: 1 });
  assert("#11 capture succeeded", c1.ok && !c1.skipped && c1.files === 4, JSON.stringify(c1));
  const v1 = validateCache(root, ORIGIN);
  assert("#3 valid cache accepted", v1.ok);
  const man = JSON.parse(readFileSync(path.join(root, "current", "manifest.json"), "utf-8"));
  assert("manifest complete marker + origin + route", man.complete === true && man.origin === ORIGIN && man.route === OFFLINE_ROUTE);
  assert("manifest stores sha256 per file",
    man.files.every((f: { sha256: string; file: string }) =>
      f.sha256 === createHash("sha256").update(readFileSync(path.join(root, "current", f.file))).digest("hex")));
  assert("#10 no headers other than content-type stored",
    man.files.every((f: Record<string, unknown>) => Object.keys(f).sort().join(",") === "contentType,file,sha256,size,url"));
  assert("no staging/old leftovers after capture", readdirSync(root).every((n) => n === "current"));

  // lookup: hit served, everything else passed through (#10 API never served from cache)
  if (v1.ok) {
    const hit = lookupCachedResponse(v1.manifest, v1.dir, "GET", DOC);
    assert("lookup: cached document is a hit", hit.kind === "hit" && readFileSync((hit as { file: string }).file, "utf-8") === "<html>build-A</html>");
    assert("lookup: /api passes through", lookupCachedResponse(v1.manifest, v1.dir, "GET", ORIGIN + "/api/auth/me").kind === "passthrough");
    assert("lookup: non-GET passes through", lookupCachedResponse(v1.manifest, v1.dir, "POST", DOC).kind === "passthrough");
    assert("lookup: foreign origin passes through", lookupCachedResponse(v1.manifest, v1.dir, "GET", "https://www.youtube.com/x").kind === "passthrough");
  }

  // identical URL set → skipped (no network)
  let calls = 0;
  const counting: CaptureFetch = async (u) => { calls++; return server(BUILD_A)(u); };
  const c2 = await captureRendererCache({ root, origin: ORIGIN, urls: [DOC, JS, CSS, FONT], fetchFn: counting, now: 2 });
  assert("unchanged build → refresh skipped with zero fetches", c2.ok && c2.skipped && calls === 0);

  // ── #12 refresh failure (new build, one chunk 404 = deploy race) → old current preserved ──────────────────
  const JS_B = ORIGIN + "/_next/static/chunks/ddd444.js";
  const c3 = await captureRendererCache({
    root, origin: ORIGIN, urls: [DOC, JS_B, CSS],
    fetchFn: server({ [DOC]: { body: "<html>build-B</html>", type: "text/html" }, [CSS]: BUILD_A[CSS] }), // JS_B → 404
    now: 3,
  });
  const v3 = validateCache(root, ORIGIN);
  assert("#12 refresh with a missing chunk fails", !c3.ok);
  assert("#12 old current cache preserved + still valid (build A)", v3.ok && v3.manifest.createdAt === 1 &&
    readFileSync(path.join(root, "current", v3.manifest.files.find((f) => f.url === DOC)!.file), "utf-8") === "<html>build-A</html>");
  assert("#12 failed staging removed", readdirSync(root).every((n) => n === "current"));
  assert("capture refused without the /sources document",
    !(await captureRendererCache({ root: freshRoot("nodoc"), origin: ORIGIN, urls: [JS], fetchFn: server(BUILD_A) })).ok);
  assert("capture refuses a redirect/non-200 document",
    !(await captureRendererCache({ root: freshRoot("redir"), origin: ORIGIN, urls: [DOC, JS], fetchFn: server({ [DOC]: { status: 307, body: "" }, [JS]: BUILD_A[JS] }) })).ok);

  // successful refresh to build B replaces atomically (never mixes)
  const BUILD_B = { [DOC]: { body: "<html>build-B</html>", type: "text/html" }, [JS_B]: { body: "B", type: "application/javascript" } };
  const c4 = await captureRendererCache({ root, origin: ORIGIN, urls: [DOC, JS_B], fetchFn: server(BUILD_B), now: 4 });
  const v4 = validateCache(root, ORIGIN);
  assert("build B replaces A atomically (no A chunk left in manifest)", c4.ok && v4.ok &&
    v4.manifest.files.map((f) => f.url).sort().join() === [DOC, JS_B].sort().join());

  // ── #4 missing file / #5 wrong hash / #6 incomplete / #7 staging-only ─────────────────────────────────────
  const mk = async (n: string) => { const r = freshRoot(n); await captureRendererCache({ root: r, origin: ORIGIN, urls: [DOC, JS, CSS], fetchFn: server(BUILD_A), now: 9 }); return r; };
  {
    const r = await mk("missing");
    const m = JSON.parse(readFileSync(path.join(r, "current", "manifest.json"), "utf-8"));
    rmSync(path.join(r, "current", m.files[1].file));
    const v = validateCache(r, ORIGIN);
    assert("#4 missing file → cache rejected", !v.ok && v.reason === "missing-file", JSON.stringify(v));
  }
  {
    const r = await mk("hash");
    const m = JSON.parse(readFileSync(path.join(r, "current", "manifest.json"), "utf-8"));
    const fp = path.join(r, "current", m.files[1].file);
    const orig = readFileSync(fp);
    const tampered = Buffer.from(orig); tampered[0] = tampered[0] ^ 0xff; // same size, different bytes
    writeFileSync(fp, tampered);
    const v = validateCache(r, ORIGIN);
    assert("#5 wrong hash → cache rejected", !v.ok && v.reason === "hash-mismatch", JSON.stringify(v));
  }
  {
    const r = await mk("incomplete");
    const mp = path.join(r, "current", "manifest.json");
    const m = JSON.parse(readFileSync(mp, "utf-8")); m.complete = false; writeFileSync(mp, JSON.stringify(m));
    const v = validateCache(r, ORIGIN);
    assert("#6 incomplete cache → rejected", !v.ok && v.reason === "incomplete", JSON.stringify(v));
  }
  {
    const r = freshRoot("staging");
    mkdirSync(path.join(r, "staging-123-1"), { recursive: true });
    writeFileSync(path.join(r, "staging-123-1", "manifest.json"), JSON.stringify({ complete: true }));
    const v = validateCache(r, ORIGIN);
    assert("#7 staging-only cache ignored (no current)", !v.ok && v.reason === "no-manifest");
    await captureRendererCache({ root: r, origin: ORIGIN, urls: [DOC, JS], fetchFn: server(BUILD_A), now: 10 });
    assert("#7 leftover staging cleaned on next capture", !existsSync(path.join(r, "staging-123-1")));
  }
  {
    const r = await mk("origin");
    assert("origin mismatch (TEST cache vs PROD origin) → rejected",
      !validateCache(r, "https://syncbiz-app-production.up.railway.app").ok);
  }
  assert("corrupt manifest → rejected", (() => {
    const r = freshRoot("corrupt"); mkdirSync(path.join(r, "current"), { recursive: true });
    writeFileSync(path.join(r, "current", "manifest.json"), "{not json");
    const v = validateCache(r, ORIGIN); return !v.ok && v.reason === "manifest-unreadable";
  })());

  // ── static wiring guards (index.ts / renderer-offline-cache.ts) ───────────────────────────────────────────
  const idx = read("desktop", "src", "main", "index.ts");
  const mod = read("desktop", "src", "main", "renderer-offline-cache.ts");
  const failSrc = idx.slice(idx.indexOf('win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {\n      if (!isMainFrame) return;'));
  const failBody = failSrc.slice(0, failSrc.indexOf("\n    });"));
  assert("#8 offline fallback gated on network-class error + full validation",
    /isNetworkClassLoadError\(errorCode\)/.test(failBody) && /cache\.validate\(\)/.test(failBody) && /if \(v\.ok\)/.test(failBody));
  assert("#8 offline fallback enables serving then loads hosted /sources",
    /cache\.enableOfflineServing\(v\);[\s\S]*loadURL\(cache\.origin \+ OFFLINE_ROUTE\)/.test(failBody));
  assert("#9 only did-fail-load (network) can trigger the cache — no HTTP-status hook",
    !/did-navigate[\s\S]{0,200}enableOfflineServing/.test(idx) && (idx.match(/enableOfflineServing\(/g) ?? []).length === 1);
  assert("online path unchanged: initial load still applyMainWindowContent(win, resolved) → loadURL(resolved.url)",
    /applyMainWindowContent\(win, resolved\);/.test(idx) && /void win\.loadURL\(resolved\.url\)/.test(idx));
  assert("online start URL not changed to /sources", !/hostedUrl\s*\+\s*["'`]\/sources/.test(idx) &&
    !/SYNCBIZ_HOSTED_WEB_APP_URL\s*\+/.test(idx));
  assert("no interceptor registered outside the offline-serving path",
    (idx.match(/protocol\.handle\(/g) ?? []).length === 0 && (mod.match(/protocol\.handle\(/g) ?? []).length === 1 &&
    /enableOfflineServing\([^)]*\): void \{[\s\S]*?this\.deps\.protocol\.handle\("https"/.test(mod));
  assert("#16 Retry button navigates to the hosted URL (no location.reload())",
    /onclick="location\.href=\$\{retryTarget\}"/.test(idx) && !/onclick="location\.reload\(\)"/.test(idx));
  assert("#16 no-cache fallback starts a single-timer auto retry",
    /startNetworkRetry\(win, targetUrl\);/.test(failBody) && /if \(networkRetryTimer\) return;/.test(idx) && /if \(networkRetryInFlight\) return;/.test(idx));
  const disable = mod.slice(mod.indexOf("disableOfflineServing(reason: string): void {"));
  const disableBody = disable.slice(0, disable.indexOf("\n  }\n"));
  assert("#17 internet return → unhandle only, NO renderer reload",
    /protocol\.unhandle\("https"\)/.test(disableBody) && !/loadURL\(|\.reload\(|webContents/.test(disableBody));
  assert("#17 health probe success → disableOfflineServing (no reload anywhere in module)",
    /if \(r\.ok\) this\.disableOfflineServing\(/.test(mod) && !/\.reload\(|loadURL\(/.test(mod));
  assert("cache never built from cached bytes while serving",
    /if \(this\.serving\) return; \/\/ never build a cache from cached bytes/.test(mod));
  assert("/login clears the cache (logout / account change)", /u\.pathname === "\/login"[\s\S]{0,200}clearRendererCache\(this\.root\)/.test(mod));
  assert("module imports electron TYPES only (no runtime electron import)",
    /import type \{ Net, Protocol, Session \} from "electron";/.test(mod) && !/^import \{[^}]*\} from "electron"/m.test(mod));
  assert("no playback-chain imports in the cache module",
    !/orchestrator|mpv-manager|device-ws-manager|audio-player|playback-provider/.test(mod.replace(/\/\*[\s\S]*?\*\//g, "")));

  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
})();
