/**
 * OFFLINE COLD BOOT — last-known-good hosted-renderer cache (Solution C).
 *
 * WHY: the packaged desktop loads the HOSTED renderer, and the existing renderer/provider restore path (designated
 * offline authority + local-recovery snapshot in hosted-origin localStorage) is what auto-resumes LOCAL audio. With
 * no internet at Windows boot the hosted page never loads, so nothing restores. This module lets MAIN serve the
 * SAME hosted origin from a local last-known-good copy ONLY when the live load fails with a network-class error —
 * the renderer then sees its own origin, its own localStorage, and runs its unchanged restore path.
 *
 * Invariants:
 *  - ONLINE path untouched: no interceptor while online; live network renderer always wins. Online we only OBSERVE
 *    completed requests (passive) and refresh the cache in the background after an authenticated /sources load.
 *  - Cache = the /sources document + same-origin static assets (scripts/styles/fonts/images) only. NEVER /api/*,
 *    auth, XHR/RSC fetches, WebSocket, cookies or response headers (only body + content-type are stored).
 *  - One build per cache: staging dir → manifest (sha256 per file) → `complete:true` written last → atomic swap.
 *    Any non-200 during capture aborts and keeps the old cache (content-hashed chunk names 404 across deploys, so a
 *    mixed build cannot be captured).
 *  - Offline serving is enabled only after the main frame failed with a network-class error AND the whole cache
 *    validates. When the hosted origin becomes reachable again the interceptor is REMOVED (protocol.unhandle) —
 *    the running renderer is NEVER reloaded and playback is never touched.
 *  - No playback / MPV / WS / designation logic lives here.
 *
 * Only `import type` from electron → the pure helpers are unit-testable under plain Node.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Net, Protocol, Session } from "electron";

export const OFFLINE_ROUTE = "/sources";
export const CACHE_SCHEMA_VERSION = 1;
const CACHE_DIR = "renderer-cache";
const CURRENT = "current";
const MANIFEST = "manifest.json";

/**
 * Chromium net error codes that mean "the network/host is unreachable" (as opposed to an HTTP error page, which
 * loads successfully and never reaches did-fail-load). -3 (ERR_ABORTED) is deliberately NOT included.
 */
export const NETWORK_CLASS_ERROR_CODES: ReadonlySet<number> = new Set([
  -7, // TIMED_OUT
  -15, // SOCKET_NOT_CONNECTED
  -21, // NETWORK_CHANGED
  -100, // CONNECTION_CLOSED
  -101, // CONNECTION_RESET
  -102, // CONNECTION_REFUSED
  -104, // CONNECTION_FAILED
  -105, // NAME_NOT_RESOLVED
  -106, // INTERNET_DISCONNECTED
  -109, // ADDRESS_UNREACHABLE
  -118, // CONNECTION_TIMED_OUT
  -130, // PROXY_CONNECTION_FAILED (branch proxy down = hosted origin unreachable)
  -137, // NAME_RESOLUTION_FAILED
]);

export function isNetworkClassLoadError(errorCode: number): boolean {
  return NETWORK_CLASS_ERROR_CODES.has(errorCode);
}

export type ObservedResource = {
  url: string;
  method: string;
  statusCode: number;
  /** Electron webRequest resourceType: mainFrame | subFrame | stylesheet | script | image | font | xhr | webSocket | … */
  resourceType: string;
};

const STATIC_RESOURCE_TYPES = new Set(["script", "stylesheet", "font", "image"]);

/** PURE: may this completed request be part of the last-known-good renderer cache? */
export function isCacheableResource(r: ObservedResource, hostedOrigin: string): boolean {
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return false;
  }
  if (u.origin !== hostedOrigin) return false; // never another origin
  if ((r.method || "GET").toUpperCase() !== "GET") return false;
  if (r.statusCode !== 200 && r.statusCode !== 304) return false;
  if (u.pathname.startsWith("/api/") || u.pathname === "/api") return false; // never API / auth
  if (u.searchParams.has("_rsc")) return false; // never dynamic RSC payloads
  if (r.resourceType === "mainFrame") return u.pathname === OFFLINE_ROUTE && u.search === "";
  return STATIC_RESOURCE_TYPES.has(r.resourceType); // xhr / fetch / webSocket / media / ping / other → never
}

export type CacheFileEntry = { url: string; file: string; contentType: string; size: number; sha256: string };
export type CacheManifest = {
  schemaVersion: number;
  origin: string;
  route: string;
  createdAt: number;
  complete: boolean;
  files: CacheFileEntry[];
};

export function originCacheKey(origin: string): string {
  return origin.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]/g, "_");
}

/** `<userData>/renderer-cache/<origin-key>` — per Electron profile, per hosted origin (TEST ≠ PROD). */
export function cacheRootFor(userData: string, origin: string): string {
  return path.join(userData, CACHE_DIR, originCacheKey(origin));
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export type CacheValidation = { ok: true; manifest: CacheManifest; dir: string } | { ok: false; reason: string };

/** PURE(fs): validate the ENTIRE current cache. Anything short of perfect → rejected (treated as no cache). */
export function validateCache(root: string, origin: string): CacheValidation {
  const dir = path.join(root, CURRENT);
  const mp = path.join(dir, MANIFEST);
  if (!existsSync(mp)) return { ok: false, reason: "no-manifest" };
  let m: CacheManifest;
  try {
    m = JSON.parse(readFileSync(mp, "utf-8")) as CacheManifest;
  } catch {
    return { ok: false, reason: "manifest-unreadable" };
  }
  if (m.schemaVersion !== CACHE_SCHEMA_VERSION) return { ok: false, reason: "schema" };
  if (m.complete !== true) return { ok: false, reason: "incomplete" };
  if (m.origin !== origin) return { ok: false, reason: "origin-mismatch" };
  if (m.route !== OFFLINE_ROUTE) return { ok: false, reason: "route-mismatch" };
  if (!Array.isArray(m.files) || m.files.length === 0) return { ok: false, reason: "no-files" };
  const docUrl = origin + OFFLINE_ROUTE;
  if (!m.files.some((f) => f.url === docUrl)) return { ok: false, reason: "no-document" };
  for (const f of m.files) {
    if (!f || typeof f.file !== "string" || f.file.includes("/") || f.file.includes("\\") || f.file.includes("..")) {
      return { ok: false, reason: "bad-entry" };
    }
    const fp = path.join(dir, f.file);
    if (!existsSync(fp)) return { ok: false, reason: "missing-file" };
    let buf: Buffer;
    try {
      if (statSync(fp).size !== f.size) return { ok: false, reason: "size-mismatch" };
      buf = readFileSync(fp);
    } catch {
      return { ok: false, reason: "unreadable-file" };
    }
    if (sha256(buf) !== f.sha256) return { ok: false, reason: "hash-mismatch" };
  }
  return { ok: true, manifest: m, dir };
}

/** Minimal fetch result the capture needs (Electron session.fetch / global fetch both satisfy it). */
export type CaptureFetch = (url: string) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type CaptureResult = { ok: true; skipped: boolean; files: number } | { ok: false; reason: string };

function cleanupLeftovers(root: string): void {
  try {
    for (const name of readdirSync(root)) {
      if (name.startsWith("staging-") || name.startsWith("old-")) {
        try {
          rmSync(path.join(root, name), { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* root may not exist yet */
  }
}

/**
 * Capture ONE complete renderer build into a staging dir and atomically promote it to `current`.
 * Skips (no network) when the existing valid cache already holds exactly this URL set. On ANY failure the staging
 * dir is removed and the existing `current` cache is left untouched.
 */
export async function captureRendererCache(opts: {
  root: string;
  origin: string;
  urls: string[];
  fetchFn: CaptureFetch;
  now?: number;
}): Promise<CaptureResult> {
  const { root, origin, fetchFn } = opts;
  const now = opts.now ?? Date.now();
  const docUrl = origin + OFFLINE_ROUTE;
  const urls = [...new Set(opts.urls)].filter((u) => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  });
  if (!urls.includes(docUrl)) return { ok: false, reason: "no-document" };
  if (urls.length < 2) return { ok: false, reason: "no-assets" };

  const existing = validateCache(root, origin);
  if (existing.ok) {
    const have = new Set(existing.manifest.files.map((f) => f.url));
    if (have.size === urls.length && urls.every((u) => have.has(u))) return { ok: true, skipped: true, files: have.size };
  }

  mkdirSync(root, { recursive: true });
  cleanupLeftovers(root);
  const staging = path.join(root, `staging-${now}-${process.pid}`);
  try {
    mkdirSync(staging, { recursive: true });
    const files: CacheFileEntry[] = [];
    let i = 0;
    for (const url of urls) {
      const res = await fetchFn(url);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const file = `f${String(i++).padStart(4, "0")}`;
      writeFileSync(path.join(staging, file), buf);
      // Body + content-type ONLY — never Set-Cookie or any other response header.
      files.push({ url, file, contentType: res.headers.get("content-type") || "application/octet-stream", size: buf.length, sha256: sha256(buf) });
    }
    const manifest: CacheManifest = { schemaVersion: CACHE_SCHEMA_VERSION, origin, route: OFFLINE_ROUTE, createdAt: now, complete: true, files };
    writeFileSync(path.join(staging, MANIFEST), JSON.stringify(manifest)); // complete marker is written LAST
    const cur = path.join(root, CURRENT);
    const old = path.join(root, `old-${now}-${process.pid}`);
    if (existsSync(cur)) renameSync(cur, old);
    renameSync(staging, cur);
    try {
      rmSync(old, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    return { ok: true, skipped: false, files: files.length };
  } catch (e) {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, reason: (e as Error)?.message || "capture-failed" };
  }
}

export function clearRendererCache(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export type CacheLookup = { kind: "hit"; file: string; contentType: string } | { kind: "passthrough" };

/** PURE: answer an intercepted request from the validated manifest (GET, exact URL) or pass it through. */
export function lookupCachedResponse(manifest: CacheManifest, dir: string, method: string, url: string): CacheLookup {
  if ((method || "GET").toUpperCase() !== "GET") return { kind: "passthrough" };
  const hit = manifest.files.find((f) => f.url === url);
  return hit ? { kind: "hit", file: path.join(dir, hit.file), contentType: hit.contentType } : { kind: "passthrough" };
}

type Log = (level: "INFO" | "WARN" | "ERROR", msg: string, data?: Record<string, unknown>) => void;

/** Electron glue. Created once per app; all Electron objects are injected (no top-level electron import). */
export class RendererOfflineCache {
  readonly origin: string;
  readonly root: string;
  private observed = new Map<string, ObservedResource>();
  private observerAttached = false;
  private captureTimer: ReturnType<typeof setTimeout> | null = null;
  private captureInFlight = false;
  private serving = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private healthInFlight = false;

  constructor(
    private readonly deps: { ses: Session; protocol: Protocol; net: Net; userData: string; hostedUrl: string; log: Log },
    private readonly timings = { settleMs: 15_000, healthMs: 30_000 },
  ) {
    this.origin = new URL(deps.hostedUrl).origin;
    this.root = cacheRootFor(deps.userData, this.origin);
  }

  get isServingOffline(): boolean {
    return this.serving;
  }

  /** PASSIVE online observation of completed hosted-origin requests (never modifies a request). */
  attachObserver(): void {
    if (this.observerAttached) return;
    this.observerAttached = true;
    this.deps.ses.webRequest.onCompleted({ urls: [`${this.origin}/*`] }, (d) => {
      if (this.serving) return; // never build a cache from cached bytes
      const r: ObservedResource = { url: d.url, method: d.method, statusCode: d.statusCode, resourceType: d.resourceType };
      if (isCacheableResource(r, this.origin)) this.observed.set(d.url, r);
    });
  }

  /** Main frame committed a page. Online /sources → schedule a background refresh; /login → clear (logout). */
  onMainFrameLoaded(currentUrl: string): void {
    let u: URL;
    try {
      u = new URL(currentUrl);
    } catch {
      return;
    }
    if (u.origin !== this.origin || this.serving) return;
    if (u.pathname === "/login") {
      this.cancelCapture();
      this.observed.clear();
      clearRendererCache(this.root);
      this.deps.log("INFO", "renderer-offline-cache: cleared (main frame on /login)");
      return;
    }
    if (u.pathname !== OFFLINE_ROUTE) return;
    this.cancelCapture();
    this.captureTimer = setTimeout(() => {
      this.captureTimer = null;
      void this.captureNow();
    }, this.timings.settleMs);
  }

  private cancelCapture(): void {
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
  }

  private async captureNow(): Promise<void> {
    if (this.captureInFlight || this.serving) return;
    this.captureInFlight = true;
    try {
      const urls = [this.origin + OFFLINE_ROUTE, ...[...this.observed.keys()].filter((u) => u !== this.origin + OFFLINE_ROUTE)];
      const res = await captureRendererCache({
        root: this.root,
        origin: this.origin,
        urls,
        fetchFn: (url) => this.deps.ses.fetch(url, { cache: "no-store", redirect: "manual" }),
      });
      this.deps.log(res.ok ? "INFO" : "WARN", "renderer-offline-cache: capture", res as unknown as Record<string, unknown>);
    } catch (e) {
      this.deps.log("WARN", "renderer-offline-cache: capture threw", { err: (e as Error)?.message });
    } finally {
      this.captureInFlight = false;
    }
  }

  validate(): CacheValidation {
    return validateCache(this.root, this.origin);
  }

  /**
   * Enable same-origin offline serving from a VALIDATED cache. Cache hits are served from disk; everything else is
   * passed through to the real network (fails naturally while offline, works the moment the network returns).
   * Starts a lightweight reachability probe; on success the interceptor is removed — NO renderer reload.
   */
  enableOfflineServing(v: Extract<CacheValidation, { ok: true }>): void {
    if (this.serving) return;
    const { manifest, dir } = v;
    this.deps.protocol.handle("https", (req) => {
      const hit = lookupCachedResponse(manifest, dir, req.method, req.url);
      if (hit.kind === "hit") {
        try {
          return new Response(readFileSync(hit.file), { status: 200, headers: { "content-type": hit.contentType } });
        } catch {
          return Response.error();
        }
      }
      return this.deps.net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
    this.serving = true;
    this.cancelCapture();
    this.deps.log("INFO", "renderer-offline-cache: OFFLINE serving enabled", { files: manifest.files.length, createdAt: manifest.createdAt });
    this.healthTimer = setInterval(() => void this.probeOnce(), this.timings.healthMs);
  }

  private async probeOnce(): Promise<void> {
    if (!this.serving || this.healthInFlight) return;
    this.healthInFlight = true;
    try {
      const r = await this.deps.net.fetch(`${this.origin}/manifest.webmanifest`, {
        cache: "no-store",
        bypassCustomProtocolHandlers: true,
      });
      if (r.ok) this.disableOfflineServing("hosted origin reachable");
    } catch {
      /* still offline */
    } finally {
      this.healthInFlight = false;
    }
  }

  /** Stop intercepting future requests. Deliberately does NOT reload the renderer or touch playback. */
  disableOfflineServing(reason: string): void {
    if (!this.serving) return;
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    try {
      this.deps.protocol.unhandle("https");
    } catch {
      /* ignore */
    }
    this.serving = false;
    this.deps.log("INFO", "renderer-offline-cache: OFFLINE serving disabled (no reload)", { reason });
  }
}
