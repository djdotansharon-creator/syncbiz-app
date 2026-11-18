/**
 * F1 SECURITY (2026-11-18) — SSRF-safe server-side fetch for the Next app.
 *
 * Problem this closes: a hostname-only allow/deny check cannot stop (a) a PUBLIC domain that DNS-resolves to an
 * INTERNAL IP (DNS rebinding) or (b) an HTTP redirect to an internal target. This module enforces the private-range
 * policy at the ACTUAL CONNECTION TIME.
 *
 * How:
 *  - A custom `lookup` (passed to Node http/https) resolves the hostname and validates EVERY returned IP against the
 *    shared policy (`isForbiddenResolvedIp`, lib/remote-media-url-policy). The socket therefore connects ONLY to a
 *    public IP. Because validation happens inside the very lookup the socket uses, there is no resolve→validate→connect
 *    TOCTOU gap.
 *  - We do NOT rewrite the URL host to an IP, so the TLS SNI (`servername`) and the HTTP `Host` header keep the real
 *    public hostname → HTTPS to public hosts (vhosts / cert validation) keeps working.
 *  - Redirects are followed MANUALLY (Node auto-redirect disabled): each hop's Location is re-validated by the URL
 *    policy AND re-checked at connection time by the same `lookup`. Bounded by `maxRedirects`.
 *  - Caps: total timeout, max redirects, max response bytes.
 *
 * Covers IPv4 + IPv6 + DNS resolution + HTTP redirects. Does NOT touch the playback engine, jingles, or Offline.
 */

import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { resolveRemoteMediaTarget, isForbiddenResolvedIp } from "./remote-media-url-policy";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export type SafeFetchResult = { ok: boolean; status: number; body: string; finalUrl: string };

type SafeFetchOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
};

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | { address: string; family: number }[], family?: number) => void;

/**
 * Connection-time guarded DNS lookup: resolves the hostname and blocks if ANY resolved address is internal/reserved.
 * Respects the caller's `all` option — Node's happy-eyeballs (autoSelectFamily) invokes `lookup` with `all:true` and
 * expects the callback to return an ARRAY of {address, family}; otherwise it expects (err, address, family). Returning
 * the wrong shape yields "Invalid IP address: undefined". We handle both so public hosts connect normally while every
 * candidate address is still validated.
 */
function guardedLookup(hostname: string, options: dns.LookupOneOptions | dns.LookupAllOptions | number, cb: LookupCb): void {
  const opt: { all?: boolean; family?: number } = typeof options === "object" && options ? (options as { all?: boolean; family?: number }) : {};
  const wantAll = opt.all === true;
  const family = typeof opt.family === "number" ? opt.family : 0;
  dns.lookup(hostname, { all: true, verbatim: true, family }, (err, addresses) => {
    if (err) return cb(err);
    const list = (Array.isArray(addresses) ? addresses : []) as { address: string; family: number }[];
    if (!list.length) return cb(new SsrfBlockedError(`no DNS address for ${hostname}`) as NodeJS.ErrnoException);
    for (const a of list) {
      if (isForbiddenResolvedIp(a.address, a.family)) {
        return cb(new SsrfBlockedError(`host ${hostname} resolves to forbidden address ${a.address}`) as NodeJS.ErrnoException);
      }
    }
    if (wantAll) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function requestOnce(
  rawUrl: string,
  opts: Required<SafeFetchOptions>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return reject(new SsrfBlockedError("invalid URL"));
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new SsrfBlockedError("non-http(s) protocol"));
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: "GET",
        // connection-time IP enforcement (preserves Host + SNI: URL host is unchanged). Cast: guardedLookup handles
        // both the single-result and happy-eyeballs `all` callback shapes, which the stock LookupFunction type omits.
        lookup: guardedLookup as unknown as LookupFunction,
        headers: {
          "User-Agent": opts.userAgent,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Redirects are handled by the caller; drain the body to free the socket.
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ status, headers: res.headers, body: "" });
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          bytes += c.length;
          if (bytes > opts.maxBytes) {
            req.destroy();
            resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new SsrfBlockedError("request timeout")));
    req.end();
  });
}

/**
 * SSRF-safe GET. Returns the final response body (capped) or throws SsrfBlockedError when the target (or any
 * redirect hop, at connection time) is an internal/reserved destination.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts: Required<SafeFetchOptions> = {
    timeoutMs: options.timeoutMs ?? 8000,
    maxRedirects: options.maxRedirects ?? 5,
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
    userAgent: options.userAgent ?? "Mozilla/5.0 (compatible; SyncBiz/1.0; +https://syncbiz.app)",
  };
  let current = rawUrl;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    // URL-policy pre-check on every hop (protocol / credentials / literal-private host).
    if (resolveRemoteMediaTarget(current) === null) {
      throw new SsrfBlockedError(`blocked URL (policy): ${current}`);
    }
    const res = await requestOnce(current, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      let next: string;
      try {
        next = new URL(res.headers.location, current).toString();
      } catch {
        throw new SsrfBlockedError("invalid redirect location");
      }
      current = next;
      continue;
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body, finalUrl: current };
  }
  throw new SsrfBlockedError("too many redirects");
}
